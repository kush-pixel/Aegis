import { z } from 'zod';

export const HospitalScoreSchema = z.object({
  hemoglobin: z.union([z.literal(0), z.literal(1)]),
  oncology: z.union([z.literal(0), z.literal(2)]),
  sodium: z.union([z.literal(0), z.literal(1)]),
  procedure: z.union([z.literal(0), z.literal(1)]),
  index_admission: z.union([z.literal(0), z.literal(1)]),
  num_admissions: z.number().int().min(0).max(5),
  ed_visits: z.union([z.literal(0), z.literal(1), z.literal(2)]),
  total: z.number().int().min(0).max(13),
  risk_level: z.enum(['LOW', 'INTERMEDIATE', 'HIGH']),
});

export type HospitalScore = z.infer<typeof HospitalScoreSchema>;
