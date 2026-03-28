import {
  DynamoDBDocumentClient,
  QueryCommand,
  GetCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import {
  ConnectClient,
  StartOutboundChatContactCommand,
  EndpointType,
} from '@aws-sdk/client-connect';
import { TriageProtocolSchema } from '@aegis/schemas';
import { auditLog } from '@aegis/audit';

// NOTE: sms-fallback queries CallResults using GSI call_status-created_at-index
// (PK: call_status). This GSI must be provisioned in infra/DatabaseStack.

export interface ScheduledEvent {
  source: string;
  'detail-type': string;
}

export interface SmsFallbackResult {
  processed: number;
  errors: number;
}

export interface SmsFallbackDeps {
  dynamo: DynamoDBDocumentClient;
  connect: ConnectClient;
  resultsTable: string;
  protocolsTable: string;
  connectInstanceId: string;
  connectContactFlowId: string;
  connectSourcePhoneNumber: string;
}

export async function sendSmsFallback(
  _event: ScheduledEvent,
  deps: SmsFallbackDeps,
): Promise<SmsFallbackResult> {
  const {
    dynamo,
    connect,
    resultsTable,
    protocolsTable,
    connectInstanceId,
    connectContactFlowId,
    connectSourcePhoneNumber,
  } = deps;

  const cutoffTime = new Date(Date.now() - 30 * 60 * 1000).toISOString();

  // Query via GSI — only INCOMPLETE records
  const queryResult = await dynamo.send(
    new QueryCommand({
      TableName: resultsTable,
      IndexName: 'call_status-created_at-index',
      KeyConditionExpression: 'call_status = :incomplete',
      ExpressionAttributeValues: { ':incomplete': 'INCOMPLETE' },
    }),
  );

  const candidates = (queryResult.Items ?? []).filter(
    (item) => item['created_at'] < cutoffTime && item['sms_sent'] !== true,
  );

  let processed = 0;
  let errors = 0;

  for (const item of candidates) {
    const callId = item['call_id'] as string;
    const patientId = item['patient_id'] as string;
    const patientPhone = item['patient_phone'] as string | undefined;

    try {
      // Fetch the triage protocol for this patient
      let protocolItem: Record<string, unknown> | undefined;

      if (item['sms_protocol_id']) {
        const protoResult = await dynamo.send(
          new GetCommand({
            TableName: protocolsTable,
            Key: { protocol_id: item['sms_protocol_id'] },
          }),
        );
        protocolItem = protoResult.Item as Record<string, unknown> | undefined;
      } else {
        // Fall back to scanning protocols by patient_id
        const protoScan = await dynamo.send(
          new QueryCommand({
            TableName: protocolsTable,
            IndexName: 'patient_id-index',
            KeyConditionExpression: 'patient_id = :pid',
            ExpressionAttributeValues: { ':pid': patientId },
            Limit: 1,
          }),
        );
        protocolItem = (protoScan.Items ?? [])[0] as Record<string, unknown> | undefined;
      }

      if (!protocolItem) {
        throw new Error(`No protocol found for call ${callId}`);
      }

      const protocol = TriageProtocolSchema.parse(protocolItem);

      const sortedQuestions = [...protocol.questions].sort((a, b) => a.order - b.order);
      if (sortedQuestions.length === 0) {
        throw new Error(`Protocol has no questions for call ${callId}`);
      }

      const q1 = sortedQuestions[0];
      const q2 = sortedQuestions[1];

      const smsBody = q2
        ? `Q1: ${q1.text}\nQ2: ${q2.text}\n\nReply with your answers.`
        : `Q1: ${q1.text}\n\nReply with your answer.`;

      if (!patientPhone) {
        throw new Error(`No patient_phone on call record ${callId}`);
      }

      // Send outbound SMS via Amazon Connect chat channel (connect:SMS)
      await connect.send(
        new StartOutboundChatContactCommand({
          SourceEndpoint: { Type: EndpointType.TELEPHONE_NUMBER, Address: connectSourcePhoneNumber },
          DestinationEndpoint: { Type: EndpointType.TELEPHONE_NUMBER, Address: patientPhone },
          InstanceId: connectInstanceId,
          ContactFlowId: connectContactFlowId,
          SegmentAttributes: {
            'connect:Channel': { ValueString: 'SMS' },
          },
          InitialSystemMessage: { ContentType: 'text/plain', Content: smsBody },
          Attributes: { callId, patientId },
        }),
      );

      const protocolId = protocol.protocol_id;
      const now = new Date().toISOString();

      await dynamo.send(
        new UpdateCommand({
          TableName: resultsTable,
          Key: { call_id: callId },
          UpdateExpression:
            'SET sms_sent = :t, sms_sent_at = :now, sms_question_index = :zero, sms_protocol_id = :pid, call_status = :incomplete',
          ExpressionAttributeValues: {
            ':t': true,
            ':now': now,
            ':zero': 0,
            ':pid': protocolId,
            ':incomplete': 'INCOMPLETE',
          },
        }),
      );

      auditLog({
        action: 'sms_fallback_sent',
        actor: 'sms-fallback',
        resource: 'CallResult',
        callId,
        detail: 'SMS questions dispatched to patient',
      });

      processed++;
    } catch (err) {
      auditLog({
        action: 'sms_fallback_error',
        actor: 'sms-fallback',
        resource: 'CallResult',
        callId,
        detail: `Error processing record: ${(err as Error).message}`,
      });
      errors++;
    }
  }

  return { processed, errors };
}
