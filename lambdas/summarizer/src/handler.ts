import { DynamoDBDocumentClient, GetCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { MedplumClient } from '@medplum/core';
import { getPatient, getPatientConditions, mapToPatientProfile } from '@aegis/fhir-client';
import { generateSummary } from '@aegis/bedrock-client';
import { CallResultSchema, TriageProtocolSchema } from '@aegis/schemas';
import type { Isbarr } from '@aegis/schemas';
import { auditLog } from '@aegis/audit';

const RESULTS_TABLE   = process.env['DYNAMO_TABLE_RESULTS']   ?? 'CallResults';
const PROTOCOLS_TABLE = process.env['DYNAMO_TABLE_PROTOCOLS'] ?? 'TriageProtocols';

const SNAKE_CASE_RE  = /\b\w+_\w+\b/;
const PLACEHOLDER_RE = /\[.+?\]|\{.+?\}|TODO|PLACEHOLDER/i;

function validateSummaryContent(summary: Isbarr): boolean {
  const fields = [
    summary.identify,
    summary.situation,
    summary.background,
    summary.assessment,
    summary.recommendation,
    summary.read_back,
  ];
  for (const field of fields) {
    if (field.includes('==') || field.includes('>=')) return false;
    if (SNAKE_CASE_RE.test(field))                    return false;
    if (PLACEHOLDER_RE.test(field))                   return false;
  }
  return true;
}

export interface SummarizerEvent {
  call_id: string;
  protocol_id: string;
}

export interface SummarizerResult {
  callId: string;
  summaryGenerated: boolean;
  regenerated: boolean;
}

export interface SummarizerDeps {
  dynamo: DynamoDBDocumentClient;
  bedrock: BedrockRuntimeClient;
  fhir: MedplumClient;
}

export async function summarizeCall(
  event: SummarizerEvent,
  deps: SummarizerDeps,
): Promise<SummarizerResult> {
  const { call_id, protocol_id } = event;
  const { dynamo, bedrock, fhir } = deps;

  if (!call_id || call_id.trim().length === 0) {
    throw new Error('Invalid call_id: must be non-empty');
  }

  if (!protocol_id || protocol_id.trim().length === 0) {
    throw new Error('Invalid protocol_id: must be non-empty');
  }

  const callResultResponse = await dynamo.send(
    new GetCommand({
      TableName: RESULTS_TABLE,
      Key:       { call_id },
    }),
  );

  if (!callResultResponse.Item) {
    throw new Error(`CallResult not found: ${call_id}`);
  }

  const callResult = CallResultSchema.parse(callResultResponse.Item);

  const protocolResponse = await dynamo.send(
    new GetCommand({
      TableName: PROTOCOLS_TABLE,
      Key:       { protocol_id },
    }),
  );

  if (!protocolResponse.Item) {
    throw new Error(`TriageProtocol not found: ${protocol_id}`);
  }

  const protocol = TriageProtocolSchema.parse(protocolResponse.Item);

  if (protocol.patient_id !== callResult.patient_id) {
    throw new Error(
      `Protocol ${protocol_id} does not belong to patient ${callResult.patient_id}`,
    );
  }

  const patient    = await getPatient(fhir, callResult.patient_id);
  const conditions = await getPatientConditions(fhir, callResult.patient_id);
  const profile    = mapToPatientProfile(patient, conditions);

  const rawTranscripts = Object.values(callResult.variables).map((v) => v.raw_transcript);
  const transcript     = rawTranscripts.join('\n') || 'No transcript available';

  const summaryInput = {
    patient:   profile,
    variables: callResult.variables,
    transcript,
  };

  let summary   = await generateSummary(bedrock, summaryInput);
  let regenerated = false;

  if (!validateSummaryContent(summary)) {
    summary     = await generateSummary(bedrock, summaryInput);
    regenerated = true;

    if (!validateSummaryContent(summary)) {
      throw new Error('Generated summary failed content validation after two attempts');
    }
  }

  await dynamo.send(
    new UpdateCommand({
      TableName:                 RESULTS_TABLE,
      Key:                       { call_id },
      UpdateExpression:          'SET isbarr_summary = :summary',
      ExpressionAttributeValues: { ':summary': summary },
    }),
  );

  auditLog({
    action:   'summary_generated',
    actor:    'summarizer',
    resource: 'CallResult',
    callId:   call_id,
    detail: [
      `protocolId: ${protocol.protocol_id}`,
      `regenerated: ${String(regenerated)}`,
    ].join(', '),
  });

  return { callId: call_id, summaryGenerated: true, regenerated };
}
