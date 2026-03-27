import { BedrockAgentRuntimeClient, RetrieveCommand } from '@aws-sdk/client-bedrock-agent-runtime';
import { queryKnowledgeBase } from '../knowledge-base';
import { BedrockKnowledgeBaseError } from '../errors';
import { KBResultSchema } from '../types';

jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => {
  const actual = jest.requireActual('@aws-sdk/client-bedrock-agent-runtime') as object;
  return {
    ...actual,
    RetrieveCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  };
});

function makeClient(sendImpl: () => unknown): BedrockAgentRuntimeClient {
  return {
    send: jest.fn().mockImplementation(sendImpl),
  } as unknown as BedrockAgentRuntimeClient;
}

const validInput = {
  query: 'heart failure discharge guidelines',
  knowledge_base_id: 'kb-123',
};

describe('queryKnowledgeBase — mock mode', () => {
  beforeEach(() => {
    process.env['USE_BEDROCK_MOCK'] = 'true';
  });

  afterEach(() => {
    delete process.env['USE_BEDROCK_MOCK'];
  });

  it('returns mock KB results without calling AWS', async () => {
    const client = makeClient(() => { throw new Error('should not be called'); });
    const results = await queryKnowledgeBase(client, validInput);
    expect(results.length).toBeGreaterThan(0);
    expect(client.send).not.toHaveBeenCalled();
  });

  it('each mock result passes KBResultSchema validation', async () => {
    const client = makeClient(() => { throw new Error('should not be called'); });
    const results = await queryKnowledgeBase(client, validInput);
    for (const r of results) {
      expect(() => KBResultSchema.parse(r)).not.toThrow();
    }
  });
});

describe('queryKnowledgeBase — real mode', () => {
  beforeEach(() => {
    delete process.env['USE_BEDROCK_MOCK'];
  });

  it('sends a RetrieveCommand with the correct knowledgeBaseId', async () => {
    const client = makeClient(() => ({ retrievalResults: [] }));
    await queryKnowledgeBase(client, validInput);
    expect(RetrieveCommand).toHaveBeenCalledWith(
      expect.objectContaining({ knowledgeBaseId: 'kb-123' }),
    );
  });

  it('sends retrievalQuery with the correct text', async () => {
    const client = makeClient(() => ({ retrievalResults: [] }));
    await queryKnowledgeBase(client, validInput);
    expect(RetrieveCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalQuery: { text: 'heart failure discharge guidelines' },
      }),
    );
  });

  it('maps retrievalResults to KBResult array', async () => {
    const client = makeClient(() => ({
      retrievalResults: [
        { content: { text: 'Guideline text' }, score: 0.9, location: { s3Location: { uri: 'guidelines/test.pdf' } } },
      ],
    }));
    const results = await queryKnowledgeBase(client, validInput);
    expect(results).toHaveLength(1);
    expect(results[0]!.content).toBe('Guideline text');
    expect(results[0]!.score).toBe(0.9);
    expect(results[0]!.source_uri).toBe('guidelines/test.pdf');
  });

  it('returns empty array when no results', async () => {
    const client = makeClient(() => ({ retrievalResults: [] }));
    const results = await queryKnowledgeBase(client, validInput);
    expect(results).toEqual([]);
  });

  it('handles undefined retrievalResults gracefully', async () => {
    const client = makeClient(() => ({}));
    const results = await queryKnowledgeBase(client, validInput);
    expect(results).toEqual([]);
  });

  it('uses max_results when provided', async () => {
    const client = makeClient(() => ({ retrievalResults: [] }));
    await queryKnowledgeBase(client, { ...validInput, max_results: 3 });
    expect(RetrieveCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalConfiguration: {
          vectorSearchConfiguration: { numberOfResults: 3 },
        },
      }),
    );
  });

  it('defaults to 5 results when max_results not provided', async () => {
    const client = makeClient(() => ({ retrievalResults: [] }));
    await queryKnowledgeBase(client, validInput);
    expect(RetrieveCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        retrievalConfiguration: {
          vectorSearchConfiguration: { numberOfResults: 5 },
        },
      }),
    );
  });

  it('each result passes KBResultSchema validation', async () => {
    const client = makeClient(() => ({
      retrievalResults: [
        { content: { text: 'text' }, score: 0.8 },
      ],
    }));
    const results = await queryKnowledgeBase(client, validInput);
    for (const r of results) {
      expect(() => KBResultSchema.parse(r)).not.toThrow();
    }
  });

  it('falls back to empty string when content text is undefined', async () => {
    const client = makeClient(() => ({
      retrievalResults: [{ score: 0.5 }],
    }));
    const results = await queryKnowledgeBase(client, validInput);
    expect(results[0]!.content).toBe('');
  });

  it('falls back to score 0 when score is undefined', async () => {
    const client = makeClient(() => ({
      retrievalResults: [{ content: { text: 'some text' } }],
    }));
    const results = await queryKnowledgeBase(client, validInput);
    expect(results[0]!.score).toBe(0);
  });

  it('wraps SDK errors in BedrockKnowledgeBaseError', async () => {
    const sdkErr = Object.assign(new Error('Not found'), { name: 'ResourceNotFoundException' });
    const client = makeClient(() => { throw sdkErr; });
    await expect(queryKnowledgeBase(client, validInput)).rejects.toBeInstanceOf(
      BedrockKnowledgeBaseError,
    );
  });

  it('preserves the original error as cause', async () => {
    const sdkErr = new Error('KB access denied');
    const client = makeClient(() => { throw sdkErr; });
    try {
      await queryKnowledgeBase(client, validInput);
    } catch (err) {
      expect((err as BedrockKnowledgeBaseError).cause).toBe(sdkErr);
    }
  });

  it('wraps non-Error throws in BedrockKnowledgeBaseError', async () => {
    const client = makeClient(() => { throw 'string error'; });
    await expect(queryKnowledgeBase(client, validInput)).rejects.toBeInstanceOf(
      BedrockKnowledgeBaseError,
    );
  });
});

describe('queryKnowledgeBase — input validation', () => {
  it('throws when query is empty', async () => {
    const client = makeClient(() => ({ retrievalResults: [] }));
    await expect(
      queryKnowledgeBase(client, { query: '', knowledge_base_id: 'kb-123' }),
    ).rejects.toThrow();
  });

  it('throws when knowledge_base_id is empty', async () => {
    const client = makeClient(() => ({ retrievalResults: [] }));
    await expect(
      queryKnowledgeBase(client, { query: 'some query', knowledge_base_id: '' }),
    ).rejects.toThrow();
  });
});
