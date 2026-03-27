import type { BedrockRuntimeClient } from '@aws-sdk/client-bedrock-runtime';
import type { ToolInputSchema } from '@aws-sdk/client-bedrock-runtime';
import type { DocumentType } from '@smithy/types';
import { ExtractionResultSchema } from '@aegis/schemas';
import type { ExtractionResult } from '@aegis/schemas';
import { ExtractVariablesInputSchema } from './types';
import type { ExtractVariablesInput } from './types';
import { isMockMode, getMockExtractionResults } from './mock-data';
import { converse } from './converse-helper';

const EXTRACTION_RESULT_SCHEMA: DocumentType = {
  type: 'object',
  properties: {
    value: { oneOf: [{ type: 'string' }, { type: 'number' }, { type: 'boolean' }] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    raw_transcript: { type: 'string' },
  },
  required: ['value', 'confidence', 'raw_transcript'],
};

function buildToolSchema(variableNames: string[]): ToolInputSchema {
  const properties: Record<string, DocumentType> = {};
  for (const name of variableNames) {
    properties[name] = EXTRACTION_RESULT_SCHEMA;
  }

  return {
    json: {
      type: 'object',
      properties,
      required: variableNames,
    },
  };
}

export async function extractVariables(
  client: BedrockRuntimeClient,
  input: ExtractVariablesInput,
): Promise<Record<string, ExtractionResult>> {
  const parsed = ExtractVariablesInputSchema.parse(input);

  if (isMockMode()) {
    return getMockExtractionResults(parsed.variable_names);
  }

  const modelId =
    process.env['BEDROCK_MODEL_EXTRACTOR'] ?? 'amazon.nova-lite-v1:0';

  const systemPrompt = [
    'You are a clinical variable extractor.',
    'Extract the requested variables from the patient transcript.',
    'Use the extract_variables tool to return structured results.',
    'For each variable, provide the extracted value, a confidence score between 0 and 1, and the relevant raw transcript snippet.',
  ].join(' ');

  const userMessage = [
    'Question Context:',
    parsed.question_context,
    '',
    'Transcript:',
    parsed.transcript,
    '',
    `Variables to extract: ${parsed.variable_names.join(', ')}`,
  ].join('\n');

  const toolSchema = buildToolSchema(parsed.variable_names);

  const raw = await converse(client, {
    modelId,
    systemPrompt,
    userMessage,
    toolConfig: {
      tools: [
        {
          toolSpec: {
            name: 'extract_variables',
            description: 'Extract clinical variables from the transcript',
            inputSchema: toolSchema,
          },
        },
      ],
    },
  });

  const results: Record<string, ExtractionResult> = {};
  for (const name of parsed.variable_names) {
    results[name] = ExtractionResultSchema.parse(raw[name]);
  }

  return results;
}
