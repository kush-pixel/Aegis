import type { SdohScreening } from '@aegis/schemas';
import { PRAPARE_QUESTIONS } from './questions';

export interface SdohResponses {
  readonly medication_cost_barrier: boolean;
  readonly transportation_barrier: boolean;
}

export function mapResponsesToZCodes(responses: SdohResponses): SdohScreening {
  const zCodes: string[] = [];

  for (const question of PRAPARE_QUESTIONS) {
    const answer = responses[question.id as keyof SdohResponses];
    if (answer) {
      zCodes.push(question.zCode);
    }
  }

  return {
    medication_cost_barrier: responses.medication_cost_barrier,
    transportation_barrier: responses.transportation_barrier,
    z_codes: zCodes,
  };
}
