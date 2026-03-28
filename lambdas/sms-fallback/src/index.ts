import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConnectClient } from '@aws-sdk/client-connect';
import { sendSmsFallback } from './handler';
import type { ScheduledEvent, SmsFallbackResult } from './handler';

function createDynamoClient(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['DYNAMO_ENDPOINT'] ? { endpoint: process.env['DYNAMO_ENDPOINT'] } : {}),
  });
  return DynamoDBDocumentClient.from(raw);
}

function createConnectClient(): ConnectClient {
  return new ConnectClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
}

export const handler = async (event: ScheduledEvent): Promise<SmsFallbackResult> => {
  const dynamo = createDynamoClient();
  const connect = createConnectClient();

  return sendSmsFallback(event, {
    dynamo,
    connect,
    resultsTable: process.env['DYNAMO_TABLE_RESULTS'] ?? 'CallResults',
    protocolsTable: process.env['DYNAMO_TABLE_PROTOCOLS'] ?? 'TriageProtocols',
    connectInstanceId: process.env['CONNECT_INSTANCE_ID'] ?? '',
    connectContactFlowId: process.env['CONNECT_CONTACT_FLOW_ID'] ?? '',
    connectSourcePhoneNumber: process.env['CONNECT_SOURCE_PHONE_NUMBER'] ?? '',
  });
};
