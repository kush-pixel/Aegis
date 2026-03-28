import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { LambdaClient } from '@aws-sdk/client-lambda';
import type { LexV2Event } from 'aws-lambda';
import { handleLexEvent } from './handler';

function createDynamoClient(): DynamoDBDocumentClient {
  const raw = new DynamoDBClient({
    region: process.env['AWS_REGION'] ?? 'us-east-1',
    ...(process.env['DYNAMO_ENDPOINT'] ? { endpoint: process.env['DYNAMO_ENDPOINT'] } : {}),
  });
  return DynamoDBDocumentClient.from(raw);
}

function createBedrockClient(): BedrockRuntimeClient {
  return new BedrockRuntimeClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
}

function createLambdaClient(): LambdaClient {
  return new LambdaClient({ region: process.env['AWS_REGION'] ?? 'us-east-1' });
}

export const handler = async (event: LexV2Event): Promise<unknown> => {
  return handleLexEvent(event, {
    dynamo: createDynamoClient(),
    bedrock: createBedrockClient(),
    lambdaClient: createLambdaClient(),
    patientsTable: process.env['DYNAMO_TABLE_PATIENTS'] ?? 'PatientProfiles',
    protocolsTable: process.env['DYNAMO_TABLE_PROTOCOLS'] ?? 'TriageProtocols',
    resultsTable: process.env['DYNAMO_TABLE_RESULTS'] ?? 'CallResults',
    triageEngineFunctionName: process.env['TRIAGE_ENGINE_FUNCTION_NAME'] ?? '',
    summarizerFunctionName: process.env['SUMMARIZER_FUNCTION_NAME'] ?? '',
  });
};
