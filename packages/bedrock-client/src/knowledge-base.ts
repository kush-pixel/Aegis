import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from '@aws-sdk/client-bedrock-agent-runtime';
import { QueryKnowledgeBaseInputSchema, KBResultSchema } from './types';
import type { QueryKnowledgeBaseInput, KBResult } from './types';
import { isMockMode, getMockKBResults } from './mock-data';
import { BedrockKnowledgeBaseError } from './errors';

export async function queryKnowledgeBase(
  client: BedrockAgentRuntimeClient,
  input: QueryKnowledgeBaseInput,
): Promise<KBResult[]> {
  const parsed = QueryKnowledgeBaseInputSchema.parse(input);

  if (isMockMode()) {
    return getMockKBResults();
  }

  const command = new RetrieveCommand({
    knowledgeBaseId: parsed.knowledge_base_id,
    retrievalQuery: { text: parsed.query },
    retrievalConfiguration: {
      vectorSearchConfiguration: {
        numberOfResults: parsed.max_results ?? 5,
      },
    },
  });

  let response;
  try {
    response = await client.send(command);
  } catch (err: unknown) {
    if (err instanceof Error) {
      throw new BedrockKnowledgeBaseError(err.message, { cause: err });
    }
    throw new BedrockKnowledgeBaseError('Unknown knowledge base error');
  }

  const results: KBResult[] = (response.retrievalResults ?? []).map((r) =>
    KBResultSchema.parse({
      content: r.content?.text ?? '',
      score: r.score ?? 0,
      source_uri: r.location?.s3Location?.uri,
    }),
  );

  return results;
}
