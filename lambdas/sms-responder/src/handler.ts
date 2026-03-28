import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { TriageProtocolSchema } from '@aegis/schemas';
import { auditLog } from '@aegis/audit';

// NOTE: sms-responder looks up patients via GSI phone-index on PatientProfiles (PK: phone).
// NOTE: sms-responder finds pending calls via GSI call_status-created_at-index on CallResults.
// Both GSIs must be provisioned in infra/DatabaseStack.

export interface InboundSmsEvent {
  Details: {
    ContactData: {
      Attributes: Record<string, string>;
      Channel: string;
      ContactId: string;
      CustomerEndpoint: { Address: string; Type: string };
      InitialContactId: string;
      InstanceARN: string;
    };
    Parameters: { message?: string };
  };
  Name: string;
}

export interface SmsResponderResult {
  status: 'ANSWERED' | 'IGNORED' | 'COMPLETE';
}

export interface SmsResponderDeps {
  dynamo: DynamoDBDocumentClient;
  lambdaClient: LambdaClient;
  resultsTable: string;
  protocolsTable: string;
  patientsTable: string;
  triageEngineFunctionName: string;
}

export async function respondToSms(
  event: InboundSmsEvent,
  deps: SmsResponderDeps,
): Promise<SmsResponderResult> {
  const { dynamo, lambdaClient, resultsTable, protocolsTable, patientsTable, triageEngineFunctionName } =
    deps;

  const phone = event.Details.ContactData.CustomerEndpoint.Address;
  // Parameters.message takes precedence; fall back to Attributes.message
  const message =
    event.Details.Parameters.message ??
    event.Details.ContactData.Attributes['message'] ??
    '';

  if (!phone) {
    throw new Error('Missing CustomerEndpoint.Address');
  }

  if (!message.trim()) {
    return { status: 'IGNORED' };
  }

  // Look up patient by phone via GSI phone-index on PatientProfiles
  const patientQuery = await dynamo.send(
    new QueryCommand({
      TableName: patientsTable,
      IndexName: 'phone-index',
      KeyConditionExpression: 'phone = :phone',
      ExpressionAttributeValues: { ':phone': phone },
      Limit: 1,
    }),
  );

  const patientItem = (patientQuery.Items ?? [])[0];
  if (!patientItem) {
    throw new Error('Patient not found for phone');
  }

  const patientId = patientItem['patient_id'] as string;

  // Find the most recent pending call for this patient via GSI
  const callsQuery = await dynamo.send(
    new QueryCommand({
      TableName: resultsTable,
      IndexName: 'call_status-created_at-index',
      KeyConditionExpression: 'call_status = :incomplete',
      ExpressionAttributeValues: { ':incomplete': 'INCOMPLETE' },
      ScanIndexForward: false, // descending by sort key (created_at)
    }),
  );

  const pendingCall = (callsQuery.Items ?? [])
    .filter((item) => item['patient_id'] === patientId && item['sms_sent'] === true)
    .sort((a, b) => String(b['created_at']).localeCompare(String(a['created_at'])))[0];

  if (!pendingCall) {
    return { status: 'IGNORED' };
  }

  const callId = pendingCall['call_id'] as string;
  const smsQuestionIndex = (pendingCall['sms_question_index'] as number | undefined) ?? 0;
  const smsProtocolId = pendingCall['sms_protocol_id'] as string | undefined;

  if (smsQuestionIndex >= 2) {
    return { status: 'IGNORED' };
  }

  if (!smsProtocolId) {
    throw new Error(`No sms_protocol_id on call record ${callId}`);
  }

  const protoResult = await dynamo.send(
    new GetCommand({
      TableName: protocolsTable,
      Key: { protocol_id: smsProtocolId },
    }),
  );

  if (!protoResult.Item) {
    throw new Error(`Protocol not found: ${smsProtocolId}`);
  }

  const protocol = TriageProtocolSchema.parse(protoResult.Item);
  const sortedQuestions = [...protocol.questions].sort((a, b) => a.order - b.order);
  const currentQuestion = sortedQuestions[smsQuestionIndex];

  if (!currentQuestion) {
    return { status: 'IGNORED' };
  }

  // Parse the reply into a typed value
  const trimmed = message.trim().toLowerCase();
  let parsedValue: boolean | number | undefined;

  if (trimmed === 'yes' || trimmed === 'y') {
    parsedValue = true;
  } else if (trimmed === 'no' || trimmed === 'n') {
    parsedValue = false;
  } else if (/^\d+(\.\d+)?$/.test(trimmed)) {
    parsedValue = parseFloat(trimmed);
  } else {
    return { status: 'IGNORED' };
  }

  const answer = {
    value: parsedValue,
    confidence: 1.0,
    raw_transcript: message.trim(),
  };

  const newIndex = smsQuestionIndex + 1;
  const varName = currentQuestion.variable_name;

  await dynamo.send(
    new UpdateCommand({
      TableName: resultsTable,
      Key: { call_id: callId },
      UpdateExpression: 'SET #vars.#varName = :answer, sms_question_index = :newIdx',
      ExpressionAttributeNames: {
        '#vars': 'variables',
        '#varName': varName,
      },
      ExpressionAttributeValues: {
        ':answer': answer,
        ':newIdx': newIndex,
      },
    }),
  );

  auditLog({
    action: 'sms_answer_stored',
    actor: 'sms-responder',
    resource: 'CallResult',
    callId,
    detail: `Answer stored for question index ${smsQuestionIndex}`,
  });

  if (newIndex >= 2) {
    await lambdaClient.send(
      new InvokeCommand({
        FunctionName: triageEngineFunctionName,
        InvocationType: 'Event',
        Payload: Buffer.from(
          JSON.stringify({
            callId,
            patientId,
            protocolId: smsProtocolId,
          }),
        ),
      }),
    );

    auditLog({
      action: 'triage_engine_invoked',
      actor: 'sms-responder',
      resource: 'triage-engine',
      callId,
      detail: 'Triage engine fired after both SMS answers received',
    });

    return { status: 'COMPLETE' };
  }

  return { status: 'ANSWERED' };
}
