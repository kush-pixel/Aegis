import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';

export function createBedrockClient(region?: string): BedrockRuntimeClient {
  const resolvedRegion = region ?? process.env['AWS_REGION'] ?? 'us-east-1';
  return new BedrockRuntimeClient({ region: resolvedRegion });
}

export function createKnowledgeBaseClient(region?: string): BedrockAgentRuntimeClient {
  const resolvedRegion = region ?? process.env['AWS_REGION'] ?? 'us-east-1';
  return new BedrockAgentRuntimeClient({ region: resolvedRegion });
}
