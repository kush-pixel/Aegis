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
  // Triage result fields — written by triage-engine lambda after deterministic evaluation
  broken_rules: z.array(z.string()).optional(),
  weighted_score: z.number().min(0).max(100).optional(),
  triage_completed_at: z.string().optional(),
  // SMS fallback fields — GSI partition key call_status-created_at-index on CallResults table
  call_status: z.enum(['INCOMPLETE', 'COMPLETE']).optional(),
  sms_sent: z.boolean().optional(),
  sms_sent_at: z.string().optional(),
  sms_question_index: z.number().int().min(0).optional(),
  sms_protocol_id: z.string().optional(),
  // Dashboard fields — GSI sort key and nurse acknowledgement
  call_timestamp: z.string().optional(),
  nurse_acknowledged: z.boolean().optional(),
  nurse_acknowledged_at: z.string().optional(),
  // Read-back documentation — Joint Commission requirement
  read_back: z.string().optional(),
  read_back_documented_at: z.string().optional(),
});

export type CallResult = z.infer<typeof CallResultSchema>;
