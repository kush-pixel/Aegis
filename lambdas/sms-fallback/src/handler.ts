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
import { TriageProtocolSchema, PatientProfileSchema } from '@aegis/schemas';
import { auditLog } from '@aegis/audit';

// NOTE: sms-fallback queries CallResults using GSI call_status-created_at-index
// (PK: call_status). This GSI must be provisioned in infra/DatabaseStack.

const PUBLISH_UNREACHABLE_ALERT = `mutation PublishUnreachableAlert(
  $callId: String!
  $patientId: String!
  $riskLevel: String!
  $createdAt: String!
) {
  publishUnreachableAlert(
    callId: $callId
    patientId: $patientId
    riskLevel: $riskLevel
    createdAt: $createdAt
  ) {
    callId
  }
}`;

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
  patientsTable?: string;
  appsyncEndpoint?: string;
  appsyncApiKey?: string;
  fetchFn?: (url: string, init: RequestInit) => Promise<Response>;
  cleanupEnabled?: boolean;
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
    patientsTable,
    appsyncEndpoint,
    appsyncApiKey,
    fetchFn,
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

  // ---------------------------------------------------------------------------
  // Second pass — escalate unreachable high-risk patients via AppSync
  // ---------------------------------------------------------------------------

  if (appsyncEndpoint && appsyncApiKey && fetchFn && patientsTable) {
    const escalationCutoff = new Date(Date.now() - 4 * 60 * 60 * 1000).toISOString();

    const failedQuery = await dynamo.send(
      new QueryCommand({
        TableName: resultsTable,
        IndexName: 'call_status-created_at-index',
        KeyConditionExpression: 'call_status = :failed',
        ExpressionAttributeValues: { ':failed': 'FAILED' },
      }),
    );

    const unreachable = (failedQuery.Items ?? []).filter(
      (item) => item['sms_sent'] === true && item['created_at'] < escalationCutoff,
    );

    for (const item of unreachable) {
      const callId = item['call_id'] as string;
      const patientId = item['patient_id'] as string;
      const createdAt = item['created_at'] as string;

      try {
        const patientResponse = await dynamo.send(
          new GetCommand({
            TableName: patientsTable,
            Key: { patient_id: patientId },
          }),
        );

        if (!patientResponse.Item) {
          throw new Error(`PatientProfile not found: ${patientId}`);
        }

        const patient = PatientProfileSchema.parse(patientResponse.Item);

        if (patient.composite_risk_score < 60) {
          continue;
        }

        const variables = {
          callId,
          patientId,
          riskLevel: patient.risk_level,
          createdAt,
        };

        const response = await fetchFn(appsyncEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': appsyncApiKey,
          },
          body: JSON.stringify({ query: PUBLISH_UNREACHABLE_ALERT, variables }),
        });

        if (!response.ok) {
          throw new Error(`AppSync returned HTTP ${response.status}`);
        }

        auditLog({
          action: 'unreachable_alert_published',
          actor: 'sms-fallback',
          resource: 'AppSync',
          callId,
          detail: `Published unreachable alert riskLevel=${patient.risk_level}`,
        });
      } catch (err) {
        auditLog({
          action: 'unreachable_alert_failed',
          actor: 'sms-fallback',
          resource: 'AppSync',
          callId,
          detail: `Failed to publish unreachable alert: ${(err as Error).message}`,
        });
        // Do not throw — continue to next record
      }
    }
  }

  await cleanupOrphanedProtocols(deps);

  return { processed, errors };
}

// TODO(CDK): Replace stub with real QueryCommand implementation once
// created_at-index GSI is deployed to TriageProtocols in DatabaseStack.
export async function cleanupOrphanedProtocols(deps: SmsFallbackDeps): Promise<void> {
  if (deps.cleanupEnabled !== true) {
    return;
  }

  auditLog({
    action: 'orphaned_protocol_cleanup_skipped',
    actor: 'sms-fallback',
    resource: 'TriageProtocol',
    detail: 'Cleanup requires created_at-index GSI on TriageProtocols — not yet deployed',
  });
}
