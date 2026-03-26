import { z } from 'zod';

export const LaceScoreSchema = z.object({
  length_of_stay: z.number().int().min(0).max(7),
  acuity: z.union([z.literal(0), z.literal(3)]),
  comorbidity: z.number().int().min(0).max(5),
  ed_visits: z.number().int().min(0).max(4),
  total: z.number().int().min(0).max(19),
  risk_level: z.enum(['LOW', 'MODERATE', 'HIGH']),
});

export type LaceScore = z.infer<typeof LaceScoreSchema>;
