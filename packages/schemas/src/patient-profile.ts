import { z } from 'zod';

export const PatientProfileSchema = z.object({
  patient_id: z.string().min(1),
  name: z.string().min(1),
  phone: z.string().min(1),
  discharge_date: z.string().min(1),
  conditions: z.array(z.string()),
  lace_score: z.number().int().min(0).max(19),
  hospital_score: z.number().int().min(0).max(13),
  composite_risk_score: z.number().min(0).max(100),
  risk_level: z.enum(['LOW', 'MODERATE', 'HIGH', 'VERY_HIGH']),
});

export type PatientProfile = z.infer<typeof PatientProfileSchema>;
