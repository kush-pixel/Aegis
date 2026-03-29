import { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ConnectClient, StartOutboundVoiceContactCommand } from '@aws-sdk/client-connect';
import type { MedplumClient } from '@medplum/core';
import { getPatient, getPatientConditions, mapToPatientProfile } from '@aegis/fhir-client';
import { TriageProtocolSchema, CallResultSchema } from '@aegis/schemas';
import { validatePatientId, generateCallId } from '@aegis/validation';
import { auditLog } from '@aegis/audit';

const PROTOCOLS_TABLE = process.env['DYNAMO_TABLE_PROTOCOLS'] ?? 'TriageProtocols';
const RESULTS_TABLE = process.env['DYNAMO_TABLE_RESULTS'] ?? 'CallResults';
const CONNECT_INSTANCE_ID = process.env['CONNECT_INSTANCE_ID'] ?? '';
const CONNECT_CONTACT_FLOW_ID = process.env['CONNECT_CONTACT_FLOW_ID'] ?? '';

export interface CallInitiatorEvent {
  patient_id: string;
  protocol_id: string;
}

export interface CallInitiatorResult {
  callId: string;
  contactId: string | undefined;
  patientId: string;
  protocolId: string;
}

export interface CallInitiatorDeps {
  dynamo: DynamoDBDocumentClient;
  connect: ConnectClient;
  fhir: MedplumClient;
}

export async function initiateCall(
  event: CallInitiatorEvent,
  deps: CallInitiatorDeps,
): Promise<CallInitiatorResult> {
  const { patient_id, protocol_id } = event;
  const { dynamo, connect, fhir } = deps;

  if (!validatePatientId(patient_id)) {
    throw new Error('Invalid patient_id: must be non-empty');
  }

  const protocolResult = await dynamo.send(
    new GetCommand({
      TableName: PROTOCOLS_TABLE,
      Key: { protocol_id },
    }),
  );

  if (!protocolResult.Item) {
    throw new Error(`Protocol not found: ${protocol_id}`);
  }

  const protocol = TriageProtocolSchema.parse(protocolResult.Item);

  if (protocol.patient_id !== patient_id) {
    throw new Error(
      `Protocol ${protocol_id} does not belong to patient ${patient_id}`,
    );
  }

  const patient = await getPatient(fhir, patient_id);
  const conditions = await getPatientConditions(fhir, patient_id);
  const profile = mapToPatientProfile(patient, conditions);

  // Prevent duplicate active calls for the same patient.
  // Uses patient_id-call_timestamp-index GSI on CallResults table.
  const activeCallsResult = await dynamo.send(
    new QueryCommand({
      TableName:                 RESULTS_TABLE,
      IndexName:                 'patient_id-call_timestamp-index',
      KeyConditionExpression:    'patient_id = :pid',
      FilterExpression:          'triage_status = :incomplete OR call_status = :inprogress',
      ExpressionAttributeValues: {
        ':pid':        patient_id,
        ':incomplete': 'INCOMPLETE',
        ':inprogress': 'IN_PROGRESS',
      },
    }),
  );

  if ((activeCallsResult.Items ?? []).length > 0) {
    throw new Error(
      `Active call already exists for patient ${patient_id}. Complete or cancel it before placing a new call.`,
    );
  }

  const callId = generateCallId();

  const initialRecord = CallResultSchema.parse({
    call_id:        callId,
    patient_id,
    variables:      {},
    sdoh_responses: {
      medication_cost_barrier: false,
      transportation_barrier:  false,
      z_codes:                 [],
    },
    triage_status:  'INCOMPLETE',
    call_status:    'IN_PROGRESS',
    call_timestamp: new Date().toISOString(),
    created_at:     new Date().toISOString(),
  });

  await dynamo.send(
    new PutCommand({
      TableName: RESULTS_TABLE,
      Item: initialRecord,
    }),
  );

  auditLog({
    action: 'call_result_created',
    actor: 'call-initiator',
    resource: 'CallResult',
    callId,
    detail: 'Created INCOMPLETE record for outbound call',
  });

  const connectResponse = await connect.send(
    new StartOutboundVoiceContactCommand({
      DestinationPhoneNumber: profile.phone,
      ContactFlowId: CONNECT_CONTACT_FLOW_ID,
      InstanceId: CONNECT_INSTANCE_ID,
      Attributes: {
        callId,
        patientId: patient_id,
        protocolId: protocol_id,
      },
    }),
  );

  auditLog({
    action: 'call_initiated',
    actor: 'call-initiator',
    resource: 'Connect',
    callId,
    detail: `Contact started: ${connectResponse.ContactId ?? 'unknown'}`,
  });

  return {
    callId,
    contactId: connectResponse.ContactId,
    patientId: patient_id,
    protocolId: protocol_id,
  };
}
