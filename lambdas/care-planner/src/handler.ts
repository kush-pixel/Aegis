import { randomUUID } from 'crypto';
import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
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
const RULES_TABLE       = process.env['DYNAMO_TABLE_RULES']     ?? 'ClinicalRules';
const KNOWLEDGE_BASE_ID = process.env['BEDROCK_KNOWLEDGE_BASE_ID'] ?? '';

const CONFIDENCE_REVIEW_THRESHOLD = 0.70;

export interface CarePlannerEvent {
  patient_id: string;
}

export interface CarePlannerResult {
  patientId: string;
  protocolId: string | null;
  reviewCreated: boolean;
  blockedReason?: string;
}

export interface CarePlannerDeps {
  dynamo: DynamoDBDocumentClient;
  /** Separate client used exclusively for the pre-flight rules check.
   *  Kept separate so tests can mock rules lookups independently of the
   *  main protocol/review DynamoDB operations.
   *  Production code (index.ts) passes the same underlying client.
   *  If omitted, the rules check is skipped (useful for legacy test suites). */
  rulesCheckDynamo?: DynamoDBDocumentClient;
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

  // Check that at least one condition code has a validated LATEST clinical rule.
  // Uses rulesCheckDynamo (separate dep so existing tests remain unaffected).
  // If rulesCheckDynamo is not provided, skip the check and proceed.
  if (deps.rulesCheckDynamo && profile.conditions.length > 0) {
    const ruleChecks = await Promise.all(
      profile.conditions.map(code =>
        deps.rulesCheckDynamo!.send(
          new GetCommand({
            TableName: RULES_TABLE,
            Key: { condition_code: code, version_id: 'LATEST' },
          }),
        ),
      ),
    );
    const hasAnyRule = ruleChecks.some(r => r.Item !== undefined);

    if (!hasAnyRule) {
      const codeList = profile.conditions.join(', ');
      const notes    = `No validated clinical rules exist for condition codes: ${codeList}. Nurse review required before call can be placed.`;

      const blockedReview = ProtocolReviewSchema.parse({
        review_id:        randomUUID(),
        patient_id,
        protocol_id:      'NONE',
        status:           'PENDING',
        confidence_score: 0,
        created_at:       new Date().toISOString(),
        notes,
      });

      await dynamo.send(
        new PutCommand({
          TableName: REVIEWS_TABLE,
          Item:      blockedReview,
        }),
      );

      auditLog({
        action:   'care_plan_blocked',
        actor:    'care-planner',
        resource: 'ProtocolReview',
        detail:   `Blocked: no LATEST rules for ${profile.conditions.length} condition code(s)`,
      });

      return {
        patientId:     patient_id,
        protocolId:    null,
        reviewCreated: true,
        blockedReason: 'NO_RULES_FOUND',
      };
    }
  }

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
