import { z } from 'zod';
import { PatientProfileSchema, ExtractionResultSchema } from '@aegis/schemas';

export const GenerateProtocolInputSchema = z.object({
  patient: PatientProfileSchema,
  knowledge_base_id: z.string().min(1),
});

export type GenerateProtocolInput = z.infer<typeof GenerateProtocolInputSchema>;

export const ExtractVariablesInputSchema = z.object({
  transcript: z.string().min(1),
  question_context: z.string().min(1),
  variable_names: z.array(z.string().min(1)).min(1),
});

export type ExtractVariablesInput = z.infer<typeof ExtractVariablesInputSchema>;

export const GenerateSummaryInputSchema = z.object({
  patient: PatientProfileSchema,
  variables: z.record(z.string(), ExtractionResultSchema),
  transcript: z.string().min(1),
});

export type GenerateSummaryInput = z.infer<typeof GenerateSummaryInputSchema>;

export const QueryKnowledgeBaseInputSchema = z.object({
  query: z.string().min(1),
  knowledge_base_id: z.string().min(1),
  max_results: z.number().int().min(1).max(10).optional(),
});

export type QueryKnowledgeBaseInput = z.infer<typeof QueryKnowledgeBaseInputSchema>;

export const KBResultSchema = z.object({
  content: z.string(),
  score: z.number().min(0).max(1),
  source_uri: z.string().optional(),
});

export type KBResult = z.infer<typeof KBResultSchema>;
