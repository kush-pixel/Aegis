import { z } from 'zod';

export const TriageQuestionSchema = z.object({
  question_id: z.string().min(1),
  text: z.string().min(1),
  variable_name: z.string().min(1),
  required: z.boolean(),
  order: z.number().int().min(0),
});

export const ProtocolConditionSchema = z.object({
  condition_code: z.string().min(1),
  description: z.string(),
});

export const TriageProtocolSchema = z.object({
  protocol_id: z.string().min(1),
  patient_id: z.string().min(1),
  questions: z.array(TriageQuestionSchema),
  conditions: z.array(ProtocolConditionSchema),
  confidence_score: z.number().min(0).max(1),
  created_at: z.string().min(1),
});

export type TriageQuestion = z.infer<typeof TriageQuestionSchema>;
export type ProtocolCondition = z.infer<typeof ProtocolConditionSchema>;
export type TriageProtocol = z.infer<typeof TriageProtocolSchema>;
