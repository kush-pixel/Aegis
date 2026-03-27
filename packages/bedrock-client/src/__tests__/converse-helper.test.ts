import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { converse } from '../converse-helper';
import {
  BedrockThrottlingError,
  BedrockModelError,
  BedrockGuardrailError,
} from '../errors';

jest.mock('@aws-sdk/client-bedrock-runtime', () => {
  const actual = jest.requireActual('@aws-sdk/client-bedrock-runtime') as object;
  return {
    ...actual,
    ConverseCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
  };
});

function makeClient(sendImpl: () => unknown): BedrockRuntimeClient {
  return {
    send: jest.fn().mockImplementation(sendImpl),
  } as unknown as BedrockRuntimeClient;
}

function makeSuccessResponse(toolInput: Record<string, unknown>) {
  return {
    stopReason: 'tool_use',
    output: {
      message: {
        content: [
          {
            toolUse: {
              name: 'test_tool',
              input: toolInput,
            },
          },
        ],
      },
    },
  };
}

const baseParams = {
  modelId: 'amazon.nova-lite-v1:0',
  systemPrompt: 'You are a test assistant.',
  userMessage: 'Hello',
  toolConfig: {
    tools: [
      {
        toolSpec: {
          name: 'test_tool',
          description: 'A test tool',
          inputSchema: { json: { type: 'object', properties: {} } },
        },
      },
    ],
  },
};

describe('converse', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the toolUse input from the response', async () => {
    const toolInput = { key: 'value' };
    const client = makeClient(() => makeSuccessResponse(toolInput));
    const result = await converse(client, baseParams);
    expect(result).toEqual(toolInput);
  });

  it('sends a ConverseCommand with the correct modelId', async () => {
    const client = makeClient(() => makeSuccessResponse({}));
    await converse(client, baseParams);
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ modelId: 'amazon.nova-lite-v1:0' }),
    );
  });

  it('includes system prompt in the command', async () => {
    const client = makeClient(() => makeSuccessResponse({}));
    await converse(client, { ...baseParams, systemPrompt: 'Custom system prompt' });
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        system: [{ text: 'Custom system prompt' }],
      }),
    );
  });

  it('includes user message in the command', async () => {
    const client = makeClient(() => makeSuccessResponse({}));
    await converse(client, { ...baseParams, userMessage: 'Custom user message' });
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [{ role: 'user', content: [{ text: 'Custom user message' }] }],
      }),
    );
  });

  it('includes guardrailConfig when provided', async () => {
    const client = makeClient(() => makeSuccessResponse({}));
    const guardrailConfig = { guardrailIdentifier: 'g-123', guardrailVersion: 'DRAFT' };
    await converse(client, { ...baseParams, guardrailConfig });
    expect(ConverseCommand).toHaveBeenCalledWith(
      expect.objectContaining({ guardrailConfig }),
    );
  });

  it('omits guardrailConfig when not provided', async () => {
    const client = makeClient(() => makeSuccessResponse({}));
    await converse(client, baseParams);
    const callArg = (ConverseCommand as unknown as jest.Mock).mock.calls[0][0] as Record<string, unknown>;
    expect(callArg['guardrailConfig']).toBeUndefined();
  });

  it('throws BedrockGuardrailError when stopReason is guardrail_intervened', async () => {
    const client = makeClient(() => ({
      stopReason: 'guardrail_intervened',
      output: { message: { content: [] } },
    }));
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockGuardrailError);
  });

  it('throws BedrockModelError when response has no message', async () => {
    const client = makeClient(() => ({
      stopReason: 'end_turn',
      output: {},
    }));
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockModelError);
  });

  it('throws BedrockModelError when response has no toolUse block', async () => {
    const client = makeClient(() => ({
      stopReason: 'end_turn',
      output: {
        message: {
          content: [{ text: 'I cannot use tools' }],
        },
      },
    }));
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockModelError);
  });

  it('handles undefined message content gracefully', async () => {
    const client = makeClient(() => ({
      stopReason: 'tool_use',
      output: {
        message: {
          content: undefined,
        },
      },
    }));
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockModelError);
  });

  it('maps ThrottlingException to BedrockThrottlingError', async () => {
    const throttleErr = Object.assign(new Error('Too many requests'), {
      name: 'ThrottlingException',
    });
    const client = makeClient(() => { throw throttleErr; });
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockThrottlingError);
  });

  it('maps ServiceQuotaExceededException to BedrockThrottlingError', async () => {
    const err = Object.assign(new Error('Quota exceeded'), {
      name: 'ServiceQuotaExceededException',
    });
    const client = makeClient(() => { throw err; });
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockThrottlingError);
  });

  it('maps ModelTimeoutException to BedrockModelError', async () => {
    const err = Object.assign(new Error('Model timeout'), {
      name: 'ModelTimeoutException',
    });
    const client = makeClient(() => { throw err; });
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockModelError);
  });

  it('maps ModelErrorException to BedrockModelError', async () => {
    const err = Object.assign(new Error('Model error'), {
      name: 'ModelErrorException',
    });
    const client = makeClient(() => { throw err; });
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockModelError);
  });

  it('maps ValidationException to BedrockModelError', async () => {
    const err = Object.assign(new Error('Validation failed'), {
      name: 'ValidationException',
    });
    const client = makeClient(() => { throw err; });
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockModelError);
  });

  it('maps unknown error names to BedrockModelError', async () => {
    const err = Object.assign(new Error('Some unknown error'), {
      name: 'SomeUnknownException',
    });
    const client = makeClient(() => { throw err; });
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockModelError);
  });

  it('maps non-Error throws to BedrockModelError', async () => {
    const client = makeClient(() => { throw 'string error'; });
    await expect(converse(client, baseParams)).rejects.toBeInstanceOf(BedrockModelError);
  });
});
