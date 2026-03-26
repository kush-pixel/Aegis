import { z } from 'zod';
import { ExtractionResultSchema } from './extraction-result';
import { SdohScreeningSchema } from './sdoh-screening';
import { IsbarrSchema } from './isbarr';

export const CallResultSchema = z.object({
  call_id: z.string().min(1),
  patient_id: z.string().min(1),
  variables: z.record(z.string(), ExtractionResultSchema),
  sdoh_responses: SdohScreeningSchema,
  triage_status: z.enum(['RED', 'YELLOW', 'GREEN', 'INCOMPLETE']),
  isbarr_summary: IsbarrSchema,
  created_at: z.string().min(1),
});

export type CallResult = z.infer<typeof CallResultSchema>;
