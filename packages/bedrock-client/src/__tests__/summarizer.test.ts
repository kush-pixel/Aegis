import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { generateSummary } from '../summarizer';
import { IsbarrSchema } from '@aegis/schemas';
import { BedrockThrottlingError, BedrockModelError, BedrockGuardrailError } from '../errors';

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

const validPatient = {
  patient_id: 'P456',
  name: 'Jane Doe',
  phone: '+15005550002',
  discharge_date: '2026-03-18',
  conditions: ['J18.9'],
  lace_score: 8,
  hospital_score: 5,
  composite_risk_score: 60,
  risk_level: 'MODERATE' as const,
};

const validInput = {
  patient: validPatient,
  variables: {
    cough: { value: 'yes', confidence: 0.9, raw_transcript: 'Patient confirms cough' },
  },
  transcript: 'Patient reports cough and fatigue since discharge.',
};

const validIsbarr = {
  identify: 'Patient: Jane Doe',
  situation: 'Post-discharge triage call.',
  background: 'Discharged with pneumonia.',
  assessment: 'Mild symptoms noted.',
  recommendation: 'Follow up in 48 hours.',
  read_back: 'Summary confirmed.',
};

function makeSuccessConverse(toolInput: Record<string, unknown>) {
  return () => ({
    stopReason: 'tool_use',
    output: {
      message: {
        content: [{ toolUse: { name: 'generate_isbarr_summary', input: toolInput } }],
      },
    },
  });
}

describe('generateSummary — mock mode', () => {
  beforeEach(() => {
    process.env['USE_BEDROCK_MOCK'] = 'true';
  });

  afterEach(() => {
    delete process.env['USE_BEDROCK_MOCK'];
  });

  it('returns a valid Isbarr without calling AWS', async () => {
    const client = makeClient(() => { throw new Error('should not call'); });
    const result = await generateSummary(client, validInput);
    expect(() => IsbarrSchema.parse(result)).not.toThrow();
    expect(client.send).not.toHaveBeenCalled();
  });

  it('identify section references the patient name', async () => {
    const client = makeClient(() => { throw new Error('should not call'); });
    const result = await generateSummary(client, validInput);
    expect(result.identify).toContain('Jane Doe');
  });
});

describe('generateSummary — real mode', () => {
  beforeEach(() => {
    delete process.env['USE_BEDROCK_MOCK'];
    delete process.env['BEDROCK_MODEL_SUMMARIZER'];
    delete process.env['BEDROCK_GUARDRAIL_ID'];
    delete process.env['BEDROCK_GUARDRAIL_VERSION'];
  });

  it('calls Converse with the summarizer model from env', async () => {
    process.env['BEDROCK_MODEL_SUMMARIZER'] = 'amazon.nova-lite-v1:0';
    const client = makeClient(makeSuccessConverse(validIsbarr));
    await generateSummary(client, validInput);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'amazon.nova-lite-v1:0' }),
    );
  });

  it('defaults to amazon.nova-lite-v1:0 when env not set', async () => {
    const client = makeClient(makeSuccessConverse(validIsbarr));
    await generateSummary(client, validInput);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'amazon.nova-lite-v1:0' }),
    );
  });

  it('includes guardrailConfig when BEDROCK_GUARDRAIL_ID is set', async () => {
    process.env['BEDROCK_GUARDRAIL_ID'] = 'g-abc123';
    const client = makeClient(makeSuccessConverse(validIsbarr));
    await generateSummary(client, validInput);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        guardrailConfig: expect.objectContaining({ guardrailIdentifier: 'g-abc123' }),
      }),
    );
  });

  it('uses BEDROCK_GUARDRAIL_VERSION env when set', async () => {
    process.env['BEDROCK_GUARDRAIL_ID'] = 'g-abc123';
    process.env['BEDROCK_GUARDRAIL_VERSION'] = '2';
    const client = makeClient(makeSuccessConverse(validIsbarr));
    await generateSummary(client, validInput);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        guardrailConfig: expect.objectContaining({ guardrailVersion: '2' }),
      }),
    );
  });

  it('defaults guardrailVersion to DRAFT when not set', async () => {
    process.env['BEDROCK_GUARDRAIL_ID'] = 'g-abc123';
    const client = makeClient(makeSuccessConverse(validIsbarr));
    await generateSummary(client, validInput);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        guardrailConfig: expect.objectContaining({ guardrailVersion: 'DRAFT' }),
      }),
    );
  });

  it('omits guardrailConfig when BEDROCK_GUARDRAIL_ID is not set', async () => {
    const client = makeClient(makeSuccessConverse(validIsbarr));
    await generateSummary(client, validInput);
    const callArg = (ConverseCommand as unknown as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(callArg['guardrailConfig']).toBeUndefined();
  });

  it('validates output through IsbarrSchema', async () => {
    const client = makeClient(makeSuccessConverse(validIsbarr));
    const result = await generateSummary(client, validInput);
    expect(() => IsbarrSchema.parse(result)).not.toThrow();
  });

  it('throws when guardrail intervenes', async () => {
    const client = makeClient(() => ({
      stopReason: 'guardrail_intervened',
      output: { message: { content: [] } },
    }));
    await expect(generateSummary(client, validInput)).rejects.toBeInstanceOf(BedrockGuardrailError);
  });

  it('propagates BedrockThrottlingError', async () => {
    const err = Object.assign(new Error('Throttled'), { name: 'ThrottlingException' });
    const client = makeClient(() => { throw err; });
    await expect(generateSummary(client, validInput)).rejects.toBeInstanceOf(BedrockThrottlingError);
  });

  it('propagates BedrockModelError', async () => {
    const err = Object.assign(new Error('Model error'), { name: 'ModelErrorException' });
    const client = makeClient(() => { throw err; });
    await expect(generateSummary(client, validInput)).rejects.toBeInstanceOf(BedrockModelError);
  });

  it('throws on invalid Isbarr output', async () => {
    const client = makeClient(makeSuccessConverse({ bad: 'data' }));
    await expect(generateSummary(client, validInput)).rejects.toThrow();
  });
});

describe('generateSummary — input validation', () => {
  it('throws when transcript is empty', async () => {
    const client = makeClient(() => ({}));
    await expect(
      generateSummary(client, { ...validInput, transcript: '' }),
    ).rejects.toThrow();
  });

  it('throws when patient_id is empty', async () => {
    const client = makeClient(() => ({}));
    await expect(
      generateSummary(client, {
        ...validInput,
        patient: { ...validPatient, patient_id: '' },
      }),
    ).rejects.toThrow();
  });
});
