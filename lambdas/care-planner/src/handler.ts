import { randomUUID } from 'crypto';
import { DynamoDBDocumentClient, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import type { MedplumClient } from '@medplum/core';
import { getPatient, getPatientConditions, mapToPatientProfile } from '@aegis/fhir-client';
import { calcCompositeRisk } from '@aegis/risk-scorer';
import { generateProtocol } from '@aegis/bedrock-client';
import { TriageProtocolSchema, ProtocolReviewSchema } from '@aegis/schemas';
import { validatePatientId } from '@aegis/validation';
import { auditLog } from '@aegis/audit';

const PROTOCOLS_TABLE   = process.env['DYNAMO_TABLE_PROTOCOLS'] ?? 'TriageProtocols';
const REVIEWS_TABLE     = process.env['DYNAMO_TABLE_REVIEWS']   ?? 'ProtocolReview';
const KNOWLEDGE_BASE_ID = process.env['BEDROCK_KNOWLEDGE_BASE_ID'] ?? '';

const CONFIDENCE_REVIEW_THRESHOLD = 0.70;

export interface CarePlannerEvent {
  patient_id: string;
}

export interface CarePlannerResult {
  patientId: string;
  protocolId: string;
  reviewCreated: boolean;
}

export interface CarePlannerDeps {
  dynamo: DynamoDBDocumentClient;
  bedrock: BedrockRuntimeClient;
  kbClient: BedrockAgentRuntimeClient;
  fhir: MedplumClient;
}

export async function generateCarePlan(
  event: CarePlannerEvent,
  deps: CarePlannerDeps,
): Promise<CarePlannerResult> {
  const { patient_id } = event;
  const { dynamo, bedrock, kbClient, fhir } = deps;

  if (!validatePatientId(patient_id)) {
    throw new Error('Invalid patient_id: must be non-empty');
  }

  const patient    = await getPatient(fhir, patient_id);
  const conditions = await getPatientConditions(fhir, patient_id);
  const profile    = mapToPatientProfile(patient, conditions);

  const compositeRisk = calcCompositeRisk({
    lace_score:     profile.lace_score,
    hospital_score: profile.hospital_score,
  });

  const rawProtocol = await generateProtocol(bedrock, kbClient, {
    patient:           profile,
    knowledge_base_id: KNOWLEDGE_BASE_ID,
  });

  const protocol = TriageProtocolSchema.parse(rawProtocol);

  await dynamo.send(
    new PutCommand({
      TableName: PROTOCOLS_TABLE,
      Item:      protocol,
    }),
  );

  let reviewCreated = false;

  if (protocol.confidence_score < CONFIDENCE_REVIEW_THRESHOLD) {
    // TODO: CDK — requires patient_id-index GSI on ProtocolReview table
    const reviewResponse = await dynamo.send(
      new QueryCommand({
        TableName:                 REVIEWS_TABLE,
        IndexName:                 'patient_id-index',
        KeyConditionExpression:    'patient_id = :pid',
        FilterExpression:          '#s IN (:pending, :approved, :auto)',
        ExpressionAttributeNames:  { '#s': 'status' },
        ExpressionAttributeValues: {
          ':pid':      patient_id,
          ':pending':  'PENDING',
          ':approved': 'APPROVED',
          ':auto':     'AUTO_APPROVED',
        },
      }),
    );

    if ((reviewResponse.Items ?? []).length === 0) {
      const reviewItem = ProtocolReviewSchema.parse({
        review_id:        randomUUID(),
        patient_id,
        protocol_id:      protocol.protocol_id,
        status:           'PENDING',
        confidence_score: protocol.confidence_score,
        created_at:       new Date().toISOString(),
      });

      await dynamo.send(
        new PutCommand({
          TableName: REVIEWS_TABLE,
          Item:      reviewItem,
        }),
      );

      reviewCreated = true;
    }
  }

  auditLog({
    action:   'care_plan_generated',
    actor:    'care-planner',
    resource: 'TriageProtocol',
    detail: [
      `protocolId: ${protocol.protocol_id}`,
      `confidence: ${protocol.confidence_score}`,
      `compositeRisk: ${compositeRisk.risk_level}`,
      `reviewCreated: ${String(reviewCreated)}`,
    ].join(', '),
  });

  return {
    patientId:     patient_id,
    protocolId:    protocol.protocol_id,
    reviewCreated,
  };
}
