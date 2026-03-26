import { z } from 'zod';
import { LaceScoreSchema } from '@aegis/schemas';
import type { LaceScore } from '@aegis/schemas';

export const LaceInputSchema = z.object({
  length_of_stay_days: z.number().int().min(0),
  acuity_emergent: z.boolean(),
  charlson_index: z.number().int().min(0),
  ed_visits_6mo: z.number().int().min(0),
});

export type LaceInput = z.infer<typeof LaceInputSchema>;

function laceRiskLevel(total: number): 'LOW' | 'MODERATE' | 'HIGH' {
  if (total < 5) return 'LOW';
  if (total < 10) return 'MODERATE';
  return 'HIGH';
}

export function calcLaceScore(input: LaceInput): LaceScore {
  const parsed = LaceInputSchema.parse(input);

  const length_of_stay = Math.min(parsed.length_of_stay_days, 7);
  const acuity = parsed.acuity_emergent ? 3 : 0;
  const comorbidity = Math.min(parsed.charlson_index, 5);
  const ed_visits = Math.min(parsed.ed_visits_6mo, 4);
  const total = length_of_stay + acuity + comorbidity + ed_visits;

  return LaceScoreSchema.parse({
    length_of_stay,
    acuity,
    comorbidity,
    ed_visits,
    total,
    risk_level: laceRiskLevel(total),
  });
}
