import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createBedrockClient } from '@aegis/bedrock-client';
import { createMedplumClient, authenticateClient } from '@aegis/fhir-client';
import { summarizeCall } from './handler';
import type { SummarizerEvent } from './handler';

function createDynamoClient(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['DYNAMO_ENDPOINT'] ? { endpoint: process.env['DYNAMO_ENDPOINT'] } : {}),
  });
  return DynamoDBDocumentClient.from(raw);
}

export const handler = async (event: SummarizerEvent): Promise<unknown> => {
  const dynamo  = createDynamoClient();
  const bedrock = createBedrockClient();
  const fhir    = createMedplumClient(process.env['MEDPLUM_BASE_URL']);

  if (process.env['MEDPLUM_CLIENT_ID'] && process.env['MEDPLUM_CLIENT_SECRET']) {
    await authenticateClient(
      fhir,
      process.env['MEDPLUM_CLIENT_ID'],
      process.env['MEDPLUM_CLIENT_SECRET'],
    );
  }

  return summarizeCall(event, { dynamo, bedrock, fhir });
};
