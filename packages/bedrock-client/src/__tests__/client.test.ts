import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { createBedrockClient, createKnowledgeBaseClient } from '../client';

async function resolveRegion(client: { config: { region: string | (() => Promise<string>) } }): Promise<string> {
  return typeof client.config.region === 'function'
    ? client.config.region()
    : client.config.region;
}

describe('createBedrockClient', () => {
  const originalEnv = process.env['AWS_REGION'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['AWS_REGION'];
    } else {
      process.env['AWS_REGION'] = originalEnv;
    }
  });

  it('returns a BedrockRuntimeClient instance', () => {
    const client = createBedrockClient();
    expect(client).toBeInstanceOf(BedrockRuntimeClient);
  });

  it('uses the provided region when given', async () => {
    const client = createBedrockClient('eu-west-1');
    expect(await resolveRegion(client)).toBe('eu-west-1');
  });

  it('reads AWS_REGION from env when no arg provided', async () => {
    process.env['AWS_REGION'] = 'ap-southeast-1';
    const client = createBedrockClient();
    expect(await resolveRegion(client)).toBe('ap-southeast-1');
  });

  it('defaults to us-east-1 when env not set', async () => {
    delete process.env['AWS_REGION'];
    const client = createBedrockClient();
    expect(await resolveRegion(client)).toBe('us-east-1');
  });
});

describe('createKnowledgeBaseClient', () => {
  const originalEnv = process.env['AWS_REGION'];

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env['AWS_REGION'];
    } else {
      process.env['AWS_REGION'] = originalEnv;
    }
  });

  it('returns a BedrockAgentRuntimeClient instance', () => {
    const client = createKnowledgeBaseClient();
    expect(client).toBeInstanceOf(BedrockAgentRuntimeClient);
  });

  it('uses the provided region when given', async () => {
    const client = createKnowledgeBaseClient('eu-west-1');
    expect(await resolveRegion(client)).toBe('eu-west-1');
  });

  it('reads AWS_REGION from env when no arg provided', async () => {
    process.env['AWS_REGION'] = 'ap-southeast-1';
    const client = createKnowledgeBaseClient();
    expect(await resolveRegion(client)).toBe('ap-southeast-1');
  });

  it('defaults to us-east-1 when env not set', async () => {
    delete process.env['AWS_REGION'];
    const client = createKnowledgeBaseClient();
    expect(await resolveRegion(client)).toBe('us-east-1');
  });
});
