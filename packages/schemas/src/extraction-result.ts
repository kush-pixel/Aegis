import { z } from 'zod';

export const ExtractionResultSchema = z.object({
  value: z.union([z.string(), z.number(), z.boolean()]),
  confidence: z.number().min(0).max(1),
  raw_transcript: z.string(),
});

export type ExtractionResult = z.infer<typeof ExtractionResultSchema>;
