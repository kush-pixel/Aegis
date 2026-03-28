import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { ConnectClient } from '@aws-sdk/client-connect';
import { createMedplumClient, authenticateClient } from '@aegis/fhir-client';
import { initiateCall } from './handler';
import type { CallInitiatorEvent } from './handler';

function createDynamoClient(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['DYNAMO_ENDPOINT'] ? { endpoint: process.env['DYNAMO_ENDPOINT'] } : {}),
  });
  return DynamoDBDocumentClient.from(raw);
}

function createConnectClientInstance(): ConnectClient {
  return new ConnectClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
}

export const handler = async (event: CallInitiatorEvent): Promise<unknown> => {
  const dynamo = createDynamoClient();
  const connect = createConnectClientInstance();
  const fhir = createMedplumClient(process.env['MEDPLUM_BASE_URL']);

  if (process.env['MEDPLUM_CLIENT_ID'] && process.env['MEDPLUM_CLIENT_SECRET']) {
    await authenticateClient(
      fhir,
      process.env['MEDPLUM_CLIENT_ID'],
      process.env['MEDPLUM_CLIENT_SECRET'],
    );
  }

  return initiateCall(event, { dynamo, connect, fhir });
};
