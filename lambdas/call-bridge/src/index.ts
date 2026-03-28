import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { bridgeCall } from './handler';
import type { ConnectContactFlowEvent } from './handler';

function createDynamoClient(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['DYNAMO_ENDPOINT'] ? { endpoint: process.env['DYNAMO_ENDPOINT'] } : {}),
  });
  return DynamoDBDocumentClient.from(raw);
}

function createLambdaClient(): LambdaClient {
  return new LambdaClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
}

export const handler = async (event: ConnectContactFlowEvent): Promise<Record<string, string>> => {
  const dynamo = createDynamoClient();
  const lambdaClient = createLambdaClient();

  return bridgeCall(event, {
    dynamo,
    lambdaClient,
    resultsTable: process.env['DYNAMO_TABLE_RESULTS'] ?? 'CallResults',
    sentinelFunctionName: process.env['SENTINEL_NOVA_SONIC_FUNCTION_NAME'] ?? '',
  });
};
