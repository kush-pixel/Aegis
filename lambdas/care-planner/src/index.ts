import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { createBedrockClient, createKnowledgeBaseClient } from '@aegis/bedrock-client';
import { createMedplumClient, authenticateClient } from '@aegis/fhir-client';
import { generateCarePlan } from './handler';
import type { CarePlannerEvent } from './handler';

function createDynamoClient(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['DYNAMO_ENDPOINT'] ? { endpoint: process.env['DYNAMO_ENDPOINT'] } : {}),
  });
  return DynamoDBDocumentClient.from(raw);
}

export const handler = async (event: CarePlannerEvent): Promise<unknown> => {
  const dynamo   = createDynamoClient();
  const bedrock  = createBedrockClient();
  const kbClient = createKnowledgeBaseClient();
  const fhir     = createMedplumClient(process.env['MEDPLUM_BASE_URL']);

  if (process.env['MEDPLUM_CLIENT_ID'] && process.env['MEDPLUM_CLIENT_SECRET']) {
    await authenticateClient(
      fhir,
      process.env['MEDPLUM_CLIENT_ID'],
      process.env['MEDPLUM_CLIENT_SECRET'],
    );
  }

  return generateCarePlan(event, { dynamo, bedrock, kbClient, fhir });
};
