import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';

export function createDynamoClient(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['DYNAMO_ENDPOINT']
      ? { endpoint: process.env['DYNAMO_ENDPOINT'] }
      : {}),
  });
  return DynamoDBDocumentClient.from(raw);
}
