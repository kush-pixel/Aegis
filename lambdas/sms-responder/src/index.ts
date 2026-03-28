import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { respondToSms } from './handler';
import type { InboundSmsEvent, SmsResponderResult } from './handler';

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

export const handler = async (event: InboundSmsEvent): Promise<SmsResponderResult> => {
  const dynamo = createDynamoClient();
  const lambdaClient = createLambdaClient();

  return respondToSms(event, {
    dynamo,
    lambdaClient,
    resultsTable: process.env['DYNAMO_TABLE_RESULTS'] ?? 'CallResults',
    protocolsTable: process.env['DYNAMO_TABLE_PROTOCOLS'] ?? 'TriageProtocols',
    patientsTable: process.env['DYNAMO_TABLE_PATIENTS'] ?? 'PatientProfiles',
    triageEngineFunctionName: process.env['TRIAGE_ENGINE_FUNCTION_NAME'] ?? '',
  });
};
