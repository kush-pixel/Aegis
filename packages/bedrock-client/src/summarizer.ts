import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import { IsbarrSchema } from '@aegis/schemas';
import type { Isbarr } from '@aegis/schemas';
import { GenerateSummaryInputSchema } from './types';
import type { GenerateSummaryInput } from './types';
import { isMockMode, getMockSummary } from './mock-data';
import { converse } from './converse-helper';

const TOOL_NAME = 'generate_isbarr_summary';

const TOOL_SCHEMA = {
  json: {
    type: 'object',
    properties: {
      identify: { type: 'string', minLength: 1 },
      situation: { type: 'string', minLength: 1 },
      background: { type: 'string', minLength: 1 },
      assessment: { type: 'string', minLength: 1 },
      recommendation: { type: 'string', minLength: 1 },
      read_back: { type: 'string', minLength: 1 },
    },
    required: ['identify', 'situation', 'background', 'assessment', 'recommendation', 'read_back'],
  },
};

export async function generateSummary(
  client: BedrockRuntimeClient,
  input: GenerateSummaryInput,
): Promise<Isbarr> {
  const parsed = GenerateSummaryInputSchema.parse(input);

  if (isMockMode()) {
    return getMockSummary(parsed.patient.name);
  }

  const modelId =
    process.env['BEDROCK_MODEL_SUMMARIZER'] ?? 'amazon.nova-lite-v1:0';

  const guardrailId = process.env['BEDROCK_GUARDRAIL_ID'];
  const guardrailVersion =
    process.env['BEDROCK_GUARDRAIL_VERSION'] ?? 'DRAFT';

  const variableSummary = Object.entries(parsed.variables)
    .map(([key, val]) => `${key}: ${String(val.value)} (confidence: ${val.confidence})`)
    .join('\n');

  const systemPrompt = [
    'You are a clinical summary generator.',
    'Generate an I-SBARR summary for the completed triage call.',
    'Use the generate_isbarr_summary tool to return structured output.',
    'I-SBARR sections: Identify, Situation, Background, Assessment, Recommendation, Read-back.',
  ].join(' ');

  const userMessage = [
    `Patient: ${parsed.patient.name}`,
    `Risk Level: ${parsed.patient.risk_level}`,
    `Conditions: ${parsed.patient.conditions.join(', ')}`,
    '',
    'Extracted Variables:',
    variableSummary,
    '',
    'Call Transcript:',
    parsed.transcript,
  ].join('\n');

  const guardrailConfig = guardrailId
    ? {
        guardrailIdentifier: guardrailId,
        guardrailVersion,
      }
    : undefined;

  const raw = await converse(client, {
    modelId,
    systemPrompt,
    userMessage,
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: TOOL_NAME,
            description: 'Generate an I-SBARR clinical summary',
            inputSchema: TOOL_SCHEMA,
          },
        },
      ],
    },
    guardrailConfig,
  });

  return IsbarrSchema.parse(raw);
}
