import { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { generateProtocol } from '../care-planner';
import { TriageProtocolSchema } from '@aegis/schemas';
import { BedrockThrottlingError, BedrockModelError } from '../errors';

jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  const actual = jest.requireActual('@aws-sdk/client-bedrock-runtime') as object;
  return {
    ...actual,
    ConverseCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  };
});

jest.mock('@aws-sdk/client-bedrock-agent-runtime', () => {
  const actual = jest.requireActual('@aws-sdk/client-bedrock-agent-runtime') as object;
  return {
    ...actual,
    RetrieveCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  };
});

function makeBedrockClient(sendImpl: () => unknown): BedrockRuntimeClient {
  return { send: jest.fn().mockImplementation(sendImpl) } as unknown as BedrockRuntimeClient;
}

function makeKbClient(sendImpl: () => unknown): BedrockAgentRuntimeClient {
  return { send: jest.fn().mockImplementation(sendImpl) } as unknown as BedrockAgentRuntimeClient;
}

const validPatient = {
  patient_id: 'P123',
  name: 'John Smith',
  phone: '+15005550001',
  discharge_date: '2026-03-20',
  conditions: ['I50.9'],
  lace_score: 10,
  hospital_score: 7,
  composite_risk_score: 75,
  risk_level: 'HIGH' as const,
};

const validInput = {
  patient: validPatient,
  knowledge_base_id: 'kb-abc',
};

const validProtocol = {
  protocol_id: 'proto-001',
  patient_id: 'P123',
  questions: [
    { question_id: 'q1', text: 'Any chest pain?', variable_name: 'chest_pain', required: true, order: 0 },
  ],
  conditions: [{ condition_code: 'I50.9', description: 'Heart failure' }],
  confidence_score: 0.9,
  created_at: '2026-03-20T10:00:00.000Z',
};

function makeSuccessConverse(toolInput: Record<string, unknown>) {
  return () => ({
    stopReason: 'tool_use',
    output: {
      message: {
        content: [{ toolUse: { name: 'generate_triage_protocol', input: toolInput } }],
      },
    },
  });
}

describe('generateProtocol — mock mode', () => {
  beforeEach(() => {
    process.env['USE_BEDROCK_MOCK'] = 'true';
  });

  afterEach(() => {
    delete process.env['USE_BEDROCK_MOCK'];
  });

  it('returns a valid TriageProtocol without calling AWS', async () => {
    const client = makeBedrockClient(() => { throw new Error('should not call'); });
    const kbClient = makeKbClient(() => { throw new Error('should not call'); });
    const result = await generateProtocol(client, kbClient, validInput);
    expect(() => TriageProtocolSchema.parse(result)).not.toThrow();
  });

  it('does not call client.send in mock mode', async () => {
    const client = makeBedrockClient(() => { throw new Error('should not call'); });
    const kbClient = makeKbClient(() => { throw new Error('should not call'); });
    await generateProtocol(client, kbClient, validInput);
    expect(client.send).not.toHaveBeenCalled();
    expect(kbClient.send).not.toHaveBeenCalled();
  });

  it('includes patient_id in the returned protocol', async () => {
    const client = makeBedrockClient(() => { throw new Error('should not call'); });
    const kbClient = makeKbClient(() => { throw new Error('should not call'); });
    const result = await generateProtocol(client, kbClient, validInput);
    expect(result.patient_id).toBe('P123');
  });
});

describe('generateProtocol — real mode', () => {
  beforeEach(() => {
    delete process.env['USE_BEDROCK_MOCK'];
    delete process.env['BEDROCK_MODEL_CARE_PLANNER'];
    jest.clearAllMocks();
  });

  it('queries the knowledge base before calling Converse', async () => {
    const kbClient = makeKbClient(() => ({ retrievalResults: [] }));
    const client = makeBedrockClient(makeSuccessConverse(validProtocol));
    await generateProtocol(client, kbClient, validInput);
    expect(kbClient.send).toHaveBeenCalled();
  });

  it('calls Converse with the care planner model ID from env', async () => {
    process.env['BEDROCK_MODEL_CARE_PLANNER'] = 'amazon.nova-pro-v1:0';
    const { ConverseCommand } = jest.requireMock('@aws-sdk/client-bedrock-runtime') as {
      ConverseCommand: jest.Mock;
    };
    const kbClient = makeKbClient(() => ({ retrievalResults: [] }));
    const client = makeBedrockClient(makeSuccessConverse(validProtocol));
    await generateProtocol(client, kbClient, validInput);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'amazon.nova-pro-v1:0' }),
    );
  });

  it('defaults to amazon.nova-pro-v1:0 when env not set', async () => {
    const { ConverseCommand } = jest.requireMock('@aws-sdk/client-bedrock-runtime') as {
      ConverseCommand: jest.Mock;
    };
    const kbClient = makeKbClient(() => ({ retrievalResults: [] }));
    const client = makeBedrockClient(makeSuccessConverse(validProtocol));
    await generateProtocol(client, kbClient, validInput);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'amazon.nova-pro-v1:0' }),
    );
  });

  it('validates output through TriageProtocolSchema', async () => {
    const kbClient = makeKbClient(() => ({ retrievalResults: [] }));
    const client = makeBedrockClient(makeSuccessConverse(validProtocol));
    const result = await generateProtocol(client, kbClient, validInput);
    expect(() => TriageProtocolSchema.parse(result)).not.toThrow();
  });

  it('throws BedrockModelError when Converse returns invalid protocol', async () => {
    const kbClient = makeKbClient(() => ({ retrievalResults: [] }));
    const client = makeBedrockClient(makeSuccessConverse({ invalid: true }));
    await expect(generateProtocol(client, kbClient, validInput)).rejects.toThrow();
  });

  it('propagates BedrockThrottlingError from Converse', async () => {
    const throttleErr = Object.assign(new Error('Throttled'), { name: 'ThrottlingException' });
    const kbClient = makeKbClient(() => ({ retrievalResults: [] }));
    const client = makeBedrockClient(() => { throw throttleErr; });
    await expect(generateProtocol(client, kbClient, validInput)).rejects.toBeInstanceOf(
      BedrockThrottlingError,
    );
  });

  it('propagates BedrockModelError from Converse', async () => {
    const modelErr = Object.assign(new Error('Model failed'), { name: 'ModelErrorException' });
    const kbClient = makeKbClient(() => ({ retrievalResults: [] }));
    const client = makeBedrockClient(() => { throw modelErr; });
    await expect(generateProtocol(client, kbClient, validInput)).rejects.toBeInstanceOf(
      BedrockModelError,
    );
  });

  it('includes KB guideline content in the user message when KB returns results', async () => {
    const { ConverseCommand } = jest.requireMock('@aws-sdk/client-bedrock-runtime') as {
      ConverseCommand: jest.Mock;
    };
    const kbClient = makeKbClient(() => ({
      retrievalResults: [
        { content: { text: 'Important guideline text' }, score: 0.9 },
      ],
    }));
    const client = makeBedrockClient(makeSuccessConverse(validProtocol));
    await generateProtocol(client, kbClient, validInput);
    const callArg = (ConverseCommand as unknown as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    const messages = callArg['messages'] as Array<{ role: string; content: Array<{ text: string }> }>;
    expect(messages[0]!.content[0]!.text).toContain('Important guideline text');
  });
});

describe('generateProtocol — input validation', () => {
  it('throws when patient_id is missing', async () => {
    const client = makeBedrockClient(() => ({}));
    const kbClient = makeKbClient(() => ({}));
    await expect(
      generateProtocol(client, kbClient, {
        patient: { ...validPatient, patient_id: '' },
        knowledge_base_id: 'kb-abc',
      }),
    ).rejects.toThrow();
  });

  it('throws when knowledge_base_id is empty', async () => {
    const client = makeBedrockClient(() => ({}));
    const kbClient = makeKbClient(() => ({}));
    await expect(
      generateProtocol(client, kbClient, { patient: validPatient, knowledge_base_id: '' }),
    ).rejects.toThrow();
  });
});
