import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { extractVariables } from '../extractor';
import { ExtractionResultSchema } from '@aegis/schemas';
import { BedrockThrottlingError, BedrockModelError } from '../errors';

jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  const actual = jest.requireActual('@aws-sdk/client-bedrock-runtime') as object;
  return {
    ...actual,
    ConverseCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  };
});

function makeClient(sendImpl: () => unknown): BedrockRuntimeClient {
  return { send: jest.fn().mockImplementation(sendImpl) } as unknown as BedrockRuntimeClient;
}

const validInput = {
  transcript: 'Patient reports chest pain and shortness of breath.',
  question_context: 'We are asking about symptom severity.',
  variable_names: ['chest_pain', 'shortness_of_breath'],
};

function makeSuccessConverse(toolInput: Record<string, unknown>) {
  return () => ({
    stopReason: 'tool_use',
    output: {
      message: {
        content: [{ toolUse: { name: 'extract_variables', input: toolInput } }],
      },
    },
  });
}

const validExtractionOutput = {
  chest_pain: { value: 'yes', confidence: 0.95, raw_transcript: 'Patient reports chest pain' },
  shortness_of_breath: { value: 'yes', confidence: 0.88, raw_transcript: 'and shortness of breath' },
};

describe('extractVariables — mock mode', () => {
  beforeEach(() => {
    process.env['USE_BEDROCK_MOCK'] = 'true';
  });

  afterEach(() => {
    delete process.env['USE_BEDROCK_MOCK'];
  });

  it('returns results for each variable without calling AWS', async () => {
    const client = makeClient(() => { throw new Error('should not call'); });
    const result = await extractVariables(client, validInput);
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['chest_pain', 'shortness_of_breath']));
    expect(client.send).not.toHaveBeenCalled();
  });

  it('each result passes ExtractionResultSchema validation', async () => {
    const client = makeClient(() => { throw new Error('should not call'); });
    const result = await extractVariables(client, validInput);
    for (const val of Object.values(result)) {
      expect(() => ExtractionResultSchema.parse(val)).not.toThrow();
    }
  });
});

describe('extractVariables — real mode', () => {
  beforeEach(() => {
    delete process.env['USE_BEDROCK_MOCK'];
    delete process.env['BEDROCK_MODEL_EXTRACTOR'];
  });

  it('calls Converse with extractor model from env', async () => {
    process.env['BEDROCK_MODEL_EXTRACTOR'] = 'amazon.nova-lite-v1:0';
    const client = makeClient(makeSuccessConverse(validExtractionOutput));
    await extractVariables(client, validInput);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'amazon.nova-lite-v1:0' }),
    );
  });

  it('defaults to amazon.nova-lite-v1:0 when env not set', async () => {
    const client = makeClient(makeSuccessConverse(validExtractionOutput));
    await extractVariables(client, validInput);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'amazon.nova-lite-v1:0' }),
    );
  });

  it('includes transcript in user message', async () => {
    const client = makeClient(makeSuccessConverse(validExtractionOutput));
    await extractVariables(client, validInput);
    const callArg = (ConverseCommand as unknown as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    const messages = callArg['messages'] as Array<{ role: string; content: Array<{ text: string }> }>;
    expect(messages[0]!.content[0]!.text).toContain('chest pain');
  });

  it('returns a Record with all requested variable names', async () => {
    const client = makeClient(makeSuccessConverse(validExtractionOutput));
    const result = await extractVariables(client, validInput);
    expect(Object.keys(result)).toEqual(expect.arrayContaining(['chest_pain', 'shortness_of_breath']));
  });

  it('each result passes ExtractionResultSchema validation', async () => {
    const client = makeClient(makeSuccessConverse(validExtractionOutput));
    const result = await extractVariables(client, validInput);
    for (const val of Object.values(result)) {
      expect(() => ExtractionResultSchema.parse(val)).not.toThrow();
    }
  });

  it('propagates BedrockThrottlingError', async () => {
    const err = Object.assign(new Error('Throttled'), { name: 'ThrottlingException' });
    const client = makeClient(() => { throw err; });
    await expect(extractVariables(client, validInput)).rejects.toBeInstanceOf(BedrockThrottlingError);
  });

  it('propagates BedrockModelError', async () => {
    const err = Object.assign(new Error('Model failed'), { name: 'ModelErrorException' });
    const client = makeClient(() => { throw err; });
    await expect(extractVariables(client, validInput)).rejects.toBeInstanceOf(BedrockModelError);
  });
});

describe('extractVariables — input validation', () => {
  it('throws when transcript is empty', async () => {
    const client = makeClient(() => ({}));
    await expect(
      extractVariables(client, { ...validInput, transcript: '' }),
    ).rejects.toThrow();
  });

  it('throws when question_context is empty', async () => {
    const client = makeClient(() => ({}));
    await expect(
      extractVariables(client, { ...validInput, question_context: '' }),
    ).rejects.toThrow();
  });

  it('throws when variable_names is empty', async () => {
    const client = makeClient(() => ({}));
    await expect(
      extractVariables(client, { ...validInput, variable_names: [] }),
    ).rejects.toThrow();
  });
});
