import { z } from 'zod';

export const CompositeRiskSchema = z.object({
  lace_score: z.number().int().min(0).max(19),
  lace_risk_level: z.enum(['LOW', 'MODERATE', 'HIGH']),
  hospital_score: z.number().int().min(0).max(13),
  hospital_risk_level: z.enum(['LOW', 'INTERMEDIATE', 'HIGH']),
  composite_score: z.number().min(0).max(100),
  risk_level: z.enum(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']),
});

export type CompositeRisk = z.infer<typeof CompositeRiskSchema>;
