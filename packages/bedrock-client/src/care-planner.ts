import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { BedrockAgentRuntimeClient } from '@aws-sdk/client-bedrock-agent-runtime';
import { TriageProtocolSchema } from '@aegis/schemas';
import type { TriageProtocol } from '@aegis/schemas';
import { GenerateProtocolInputSchema } from './types';
import type { GenerateProtocolInput } from './types';
import { isMockMode, getMockProtocol } from './mock-data';
import { queryKnowledgeBase } from './knowledge-base';
import { converse } from './converse-helper';

const TOOL_NAME = 'generate_triage_protocol';

const TOOL_SCHEMA = {
  json: {
    type: 'object',
    properties: {
      protocol_id: { type: 'string', minLength: 1 },
      patient_id: { type: 'string', minLength: 1 },
      questions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            question_id: { type: 'string', minLength: 1 },
            text: { type: 'string', minLength: 1 },
            variable_name: { type: 'string', minLength: 1 },
            required: { type: 'boolean' },
            order: { type: 'integer', minimum: 0 },
          },
          required: ['question_id', 'text', 'variable_name', 'required', 'order'],
        },
      },
      conditions: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            condition_code: { type: 'string', minLength: 1 },
            description: { type: 'string' },
          },
          required: ['condition_code', 'description'],
        },
      },
      confidence_score: { type: 'number', minimum: 0, maximum: 1 },
      created_at: { type: 'string', minLength: 1 },
    },
    required: [
      'protocol_id',
      'patient_id',
      'questions',
      'conditions',
      'confidence_score',
      'created_at',
    ],
  },
};

export async function generateProtocol(
  client: BedrockRuntimeClient,
  kbClient: BedrockAgentRuntimeClient,
  input: GenerateProtocolInput,
): Promise<TriageProtocol> {
  const parsed = GenerateProtocolInputSchema.parse(input);

  if (isMockMode()) {
    return getMockProtocol(parsed.patient.patient_id);
  }

  const conditions = parsed.patient.conditions;
  const kbQuery = `Post-discharge triage protocol for conditions: ${conditions.join(', ')}. Risk level: ${parsed.patient.risk_level}.`;

  const kbResults = await queryKnowledgeBase(kbClient, {
    query: kbQuery,
    knowledge_base_id: parsed.knowledge_base_id,
  });

  const guidelineContext = kbResults
    .map((r) => r.content)
    .join('\n\n');

  const modelId =
    process.env['BEDROCK_MODEL_CARE_PLANNER'] ?? 'amazon.nova-pro-v1:0';

  const systemPrompt = [
    'You are a clinical triage protocol generator for post-discharge patients.',
    'Generate a triage protocol with screening questions based on the patient conditions and clinical guidelines.',
    'Use the generate_triage_protocol tool to return structured output.',
    'Generate a unique protocol_id, include the patient_id, and set created_at to an ISO timestamp.',
  ].join(' ');

  const userMessage = [
    `Patient ID: ${parsed.patient.patient_id}`,
    `Risk Level: ${parsed.patient.risk_level}`,
    `Conditions: ${conditions.join(', ')}`,
    '',
    'Clinical Guidelines:',
    guidelineContext,
  ].join('\n');

  const raw = await converse(client, {
    modelId,
    systemPrompt,
    userMessage,
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: TOOL_NAME,
            description: 'Generate a triage protocol for the patient',
            inputSchema: TOOL_SCHEMA,
          },
        },
      ],
    },
  });

  return TriageProtocolSchema.parse(raw);
}
