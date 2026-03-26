import { z } from 'zod';

export const IsbarrSchema = z.object({
  identify: z.string().min(1),
  situation: z.string().min(1),
  background: z.string().min(1),
  assessment: z.string().min(1),
  recommendation: z.string().min(1),
  read_back: z.string().min(1),
});

export type Isbarr = z.infer<typeof IsbarrSchema>;
