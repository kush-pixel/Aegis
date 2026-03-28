import { DynamoDBDocumentClient, GetCommand } from '@aws-sdk/lib-dynamodb';
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { CallResultSchema } from '@aegis/schemas';
import { validatePatientId } from '@aegis/validation';
import { auditLog } from '@aegis/audit';

export interface ConnectContactFlowEvent {
  Details: {
    ContactData: {
      Attributes: Record<string, string>;
      Channel: string;
      ContactId: string;
      InitialContactId: string;
      InstanceARN: string;
    };
    Parameters: Record<string, string>;
  };
  Name: string;
}

export type ConnectResponse = Record<string, string>;

export interface CallBridgeDeps {
  dynamo: DynamoDBDocumentClient;
  lambdaClient: LambdaClient;
  resultsTable: string;
  sentinelFunctionName: string;
}

export async function bridgeCall(
  event: ConnectContactFlowEvent,
  deps: CallBridgeDeps,
): Promise<ConnectResponse> {
  const { dynamo, lambdaClient, resultsTable, sentinelFunctionName } = deps;

  const { callId, patientId, protocolId } = event.Details.ContactData.Attributes;

  if (!callId) {
    throw new Error('Missing required parameter: callId');
  }
  if (!patientId) {
    throw new Error('Missing required parameter: patientId');
  }
  if (!protocolId) {
    throw new Error('Missing required parameter: protocolId');
  }
  if (!validatePatientId(patientId)) {
    throw new Error('Invalid patientId');
  }

  const result = await dynamo.send(
    new GetCommand({
      TableName: resultsTable,
      Key: { call_id: callId },
    }),
  );

  if (!result.Item) {
    throw new Error('Call record not found');
  }

  CallResultSchema.parse(result.Item);

  await lambdaClient.send(
    new InvokeCommand({
      FunctionName: sentinelFunctionName,
      InvocationType: 'Event',
      Payload: Buffer.from(JSON.stringify({ callId, patientId, protocolId })),
    }),
  );

  auditLog({
    action: 'call_bridge_invoked',
    actor: 'call-bridge',
    resource: 'CallResult',
    callId,
    detail: 'Sentinel Lambda fired for active call',
  });

  return { status: 'BRIDGE_OK', callId };
}
