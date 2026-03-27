export { createBedrockClient, createKnowledgeBaseClient } from './client';

export { generateProtocol } from './care-planner';

export { extractVariables } from './extractor';

export { generateSummary } from './summarizer';

export { queryKnowledgeBase } from './knowledge-base';

export {
  BedrockThrottlingError,
  BedrockModelError,
  BedrockGuardrailError,
  BedrockKnowledgeBaseError,
} from './errors';

export {
  GenerateProtocolInputSchema,
  ExtractVariablesInputSchema,
  GenerateSummaryInputSchema,
  QueryKnowledgeBaseInputSchema,
  KBResultSchema,
} from './types';

export type {
  GenerateProtocolInput,
  ExtractVariablesInput,
  GenerateSummaryInput,
  QueryKnowledgeBaseInput,
  KBResult,
} from './types';
