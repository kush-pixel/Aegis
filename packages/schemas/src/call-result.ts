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
  isbarr_summary: IsbarrSchema.optional(),
  created_at: z.string().min(1),
  // SMS fallback fields — GSI partition key call_status-created_at-index on CallResults table
  call_status: z.enum(['INCOMPLETE', 'COMPLETE']).optional(),
  sms_sent: z.boolean().optional(),
  sms_sent_at: z.string().optional(),
  sms_question_index: z.number().int().min(0).optional(),
  sms_protocol_id: z.string().optional(),
});

export type CallResult = z.infer<typeof CallResultSchema>;
