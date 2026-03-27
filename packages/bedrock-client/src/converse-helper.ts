import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import type {
  ToolConfiguration,
  GuardrailConfiguration,
  Message,
  ContentBlock,
} from '@aws-sdk/client-bedrock-runtime';
import {
  BedrockThrottlingError,
  BedrockModelError,
  BedrockGuardrailError,
} from './errors';

export interface ConverseParams {
  modelId: string;
  systemPrompt: string;
  userMessage: string;
  toolConfig: ToolConfiguration;
  guardrailConfig?: GuardrailConfiguration;
}

export async function converse(
  client: BedrockRuntimeClient,
  params: ConverseParams,
): Promise<Record<string, unknown>> {
  const messages: Message[] = [
    {
      role: 'user',
      content: [{ text: params.userMessage }],
    },
  ];

  const command = new ConverseCommand({
    modelId: params.modelId,
    system: [{ text: params.systemPrompt }],
    messages,
    toolConfig: params.toolConfig,
    ...(params.guardrailConfig ? { guardrailConfig: params.guardrailConfig } : {}),
  });

  let response;
  try {
    response = await client.send(command);
  } catch (err: unknown) {
    throw mapSdkError(err);
  }

  if (response.stopReason === 'guardrail_intervened') {
    throw new BedrockGuardrailError('Guardrail intervened during generation');
  }

  const output = response.output;
  if (!output || !('message' in output) || !output.message) {
    throw new BedrockModelError('No message in Bedrock response');
  }

  const contentBlocks: ContentBlock[] = output.message.content ?? [];
  const toolUseBlock = contentBlocks.find(
    (block): block is ContentBlock.ToolUseMember => 'toolUse' in block,
  );

  if (!toolUseBlock) {
    throw new BedrockModelError('No toolUse block in Bedrock response');
  }

  return toolUseBlock.toolUse?.input as Record<string, unknown>;
}

function mapSdkError(err: unknown): Error {
  if (!(err instanceof Error)) {
    return new BedrockModelError('Unknown Bedrock error');
  }

  const name = err.name;
  if (
    name === 'ThrottlingException' ||
    name === 'ServiceQuotaExceededException'
  ) {
    return new BedrockThrottlingError(err.message, { cause: err });
  }

  if (
    name === 'ModelTimeoutException' ||
    name === 'ModelErrorException' ||
    name === 'ValidationException'
  ) {
    return new BedrockModelError(err.message, { cause: err });
  }

  return new BedrockModelError(err.message, { cause: err });
}
