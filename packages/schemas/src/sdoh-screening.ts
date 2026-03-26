import { z } from 'zod';

export const SdohScreeningSchema = z.object({
  medication_cost_barrier: z.boolean(),
  transportation_barrier: z.boolean(),
  z_codes: z.array(z.string()),
});

export type SdohScreening = z.infer<typeof SdohScreeningSchema>;
