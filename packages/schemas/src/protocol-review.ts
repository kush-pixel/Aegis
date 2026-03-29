import { z } from 'zod';

export const ProtocolReviewSchema = z.object({
  review_id:        z.string().min(1),
  patient_id:       z.string().min(1),
  protocol_id:      z.string().min(1),
  status:           z.enum(['PENDING', 'APPROVED', 'AUTO_APPROVED']),
  confidence_score: z.number().min(0).max(1),
  created_at:       z.string().min(1),
  notes:            z.string().optional(),
  rejection_reason: z.string().optional(),
  rejected_at:      z.string().optional(),
  approved_at:      z.string().optional(),
});

export type ProtocolReview = z.infer<typeof ProtocolReviewSchema>;
