import { z } from 'zod';
import { HospitalScoreSchema } from '@aegis/schemas';
import type { HospitalScore } from '@aegis/schemas';

export const HospitalInputSchema = z.object({
  hemoglobin_lt_12: z.boolean(),
  oncology_patient: z.boolean(),
  sodium_lt_135: z.boolean(),
  procedure_during_admission: z.boolean(),
  index_admission_urgent: z.boolean(),
  prior_admissions: z.number().int().min(0),
  length_of_stay_gte_5: z.boolean(),
});

export type HospitalInput = z.infer<typeof HospitalInputSchema>;

function scoreNumAdmissions(count: number): 0 | 2 | 5 {
  if (count === 0) return 0;
  if (count <= 5) return 2;
  return 5;
}

function hospitalRiskLevel(total: number): 'LOW' | 'INTERMEDIATE' | 'HIGH' {
  if (total <= 4) return 'LOW';
  if (total <= 6) return 'INTERMEDIATE';
  return 'HIGH';
}

export function calcHospitalScore(input: HospitalInput): HospitalScore {
  const parsed = HospitalInputSchema.parse(input);

  const hemoglobin = parsed.hemoglobin_lt_12 ? (1 as const) : (0 as const);
  const oncology = parsed.oncology_patient ? (2 as const) : (0 as const);
  const sodium = parsed.sodium_lt_135 ? (1 as const) : (0 as const);
  const procedure = parsed.procedure_during_admission ? (1 as const) : (0 as const);
  const index_admission = parsed.index_admission_urgent ? (1 as const) : (0 as const);
  const num_admissions = scoreNumAdmissions(parsed.prior_admissions);
  const ed_visits = parsed.length_of_stay_gte_5 ? (2 as const) : (0 as const);

  const total =
    hemoglobin + oncology + sodium + procedure + index_admission + num_admissions + ed_visits;

  return HospitalScoreSchema.parse({
    hemoglobin,
    oncology,
    sodium,
    procedure,
    index_admission,
    num_admissions,
    ed_visits,
    total,
    risk_level: hospitalRiskLevel(total),
  });
}
