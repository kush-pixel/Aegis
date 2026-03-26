import { z } from 'zod';
import { CompositeRiskSchema } from '@aegis/schemas';
import type { CompositeRisk } from '@aegis/schemas';

export const CompositeInputSchema = z.object({
  lace_score: z.number().int().min(0).max(19),
  hospital_score: z.number().int().min(0).max(13),
});

export type CompositeInput = z.infer<typeof CompositeInputSchema>;

function laceRiskLevel(score: number): 'LOW' | 'MODERATE' | 'HIGH' {
  if (score < 5) return 'LOW';
  if (score < 10) return 'MODERATE';
  return 'HIGH';
}

function hospitalRiskLevel(score: number): 'LOW' | 'INTERMEDIATE' | 'HIGH' {
  if (score <= 4) return 'LOW';
  if (score <= 6) return 'INTERMEDIATE';
  return 'HIGH';
}

function compositeRiskLevel(score: number): 'LOW' | 'MODERATE' | 'HIGH' | 'VERY_HIGH' {
  if (score < 30) return 'LOW';
  if (score < 60) return 'MODERATE';
  if (score < 80) return 'HIGH';
  return 'VERY_HIGH';
}

export function calcCompositeRisk(input: CompositeInput): CompositeRisk {
  const parsed = CompositeInputSchema.parse(input);

  const composite_score = Math.round(
    (parsed.lace_score / 19) * 60 + (parsed.hospital_score / 13) * 40,
  );

  return CompositeRiskSchema.parse({
    lace_score: parsed.lace_score,
    lace_risk_level: laceRiskLevel(parsed.lace_score),
    hospital_score: parsed.hospital_score,
    hospital_risk_level: hospitalRiskLevel(parsed.hospital_score),
    composite_score,
    risk_level: compositeRiskLevel(composite_score),
  });
}
