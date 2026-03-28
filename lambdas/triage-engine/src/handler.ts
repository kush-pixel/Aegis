import { DynamoDBDocumentClient, GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { CallResultSchema, PatientProfileSchema, ClinicalRuleSchema } from '@aegis/schemas';
import type { ClinicalRule } from '@aegis/schemas';
import { calcCompositeRisk } from '@aegis/risk-scorer';
import { runTriage } from '@aegis/triage-engine';
import type { TriageStatus } from '@aegis/triage-engine';
import { auditLog } from '@aegis/audit';

// DynamoDB key requirement: ClinicalRules PK=condition_code SK=version_id;
// LATEST version pointer written as version_id='LATEST'
const RESULTS_TABLE  = process.env['DYNAMO_TABLE_RESULTS']  ?? 'CallResults';
const PATIENTS_TABLE = process.env['DYNAMO_TABLE_PATIENTS'] ?? 'PatientProfiles';
const RULES_TABLE    = process.env['DYNAMO_TABLE_RULES']    ?? 'ClinicalRules';

export interface TriageEngineDeps {
  dynamo: DynamoDBDocumentClient;
}

export interface TriageEngineEvent {
  call_id: string;
}

export interface TriageEngineResult {
  callId: string;
  triageStatus: TriageStatus;
  brokenRules: string[];
  weightedScore: number;
}

export async function runTriageForCall(
  event: TriageEngineEvent,
  deps: TriageEngineDeps,
): Promise<TriageEngineResult> {
  const { call_id } = event;
  const { dynamo } = deps;

  if (!call_id || call_id.trim().length === 0) {
    throw new Error('Invalid call_id: must be non-empty');
  }

  // 1. Fetch CallResult
  const callResultResponse = await dynamo.send(
    new GetCommand({
      TableName: RESULTS_TABLE,
      Key: { call_id },
    }),
  );

  if (!callResultResponse.Item) {
    throw new Error(`CallResult not found: ${call_id}`);
  }

  const callResult = CallResultSchema.parse(callResultResponse.Item);

  // 2. Fetch PatientProfile
  const patientResponse = await dynamo.send(
    new GetCommand({
      TableName: PATIENTS_TABLE,
      Key: { patient_id: callResult.patient_id },
    }),
  );

  if (!patientResponse.Item) {
    throw new Error(`PatientProfile not found: ${callResult.patient_id}`);
  }

  const profile = PatientProfileSchema.parse(patientResponse.Item);

  // 3. Load ClinicalRules — one GetCommand per condition code using the LATEST pointer
  const rules: ClinicalRule[] = [];

  for (const condition_code of profile.conditions) {
    const ruleResponse = await dynamo.send(
      new GetCommand({
        TableName: RULES_TABLE,
        Key: { condition_code, version_id: 'LATEST' },
      }),
    );

    if (ruleResponse.Item) {
      rules.push(ClinicalRuleSchema.parse(ruleResponse.Item));
    }
  }

  // 4. Compute composite risk from pre-scored LACE + Hospital totals on the patient profile
  const compositeRisk = calcCompositeRisk({
    lace_score: profile.lace_score,
    hospital_score: profile.hospital_score,
  });

  // 5. Run deterministic triage — zero AI
  const triageResult = runTriage({
    variables: callResult.variables,
    rules,
    compositeRisk,
  });

  // 6. Validate update fields through Zod before writing to DynamoDB
  const updatePayload = CallResultSchema.pick({
    triage_status: true,
    broken_rules: true,
    weighted_score: true,
    triage_completed_at: true,
  }).parse({
    triage_status: triageResult.status,
    broken_rules: triageResult.broken_rules,
    weighted_score: compositeRisk.composite_score,
    triage_completed_at: new Date().toISOString(),
  });

  await dynamo.send(
    new UpdateCommand({
      TableName: RESULTS_TABLE,
      Key: { call_id },
      UpdateExpression:
        'SET triage_status = :status, broken_rules = :rules, weighted_score = :score, triage_completed_at = :completed_at',
      ExpressionAttributeValues: {
        ':status': updatePayload.triage_status,
        ':rules': updatePayload.broken_rules,
        ':score': updatePayload.weighted_score,
        ':completed_at': updatePayload.triage_completed_at,
      },
    }),
  );

  auditLog({
    action: 'triage_completed',
    actor: 'triage-engine',
    resource: 'CallResult',
    callId: call_id,
    detail: `Triage status: ${triageResult.status}, broken rules: ${triageResult.broken_rules.length}`,
  });

  return {
    callId: call_id,
    triageStatus: triageResult.status,
    brokenRules: triageResult.broken_rules,
    weightedScore: compositeRisk.composite_score,
  };
}
