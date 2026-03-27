export interface SdohQuestion {
  readonly id: string;
  readonly text: string;
  readonly zCode: string;
  readonly zCodeDescription: string;
}

export const PRAPARE_QUESTIONS: readonly SdohQuestion[] = [
  {
    id: 'medication_cost_barrier',
    text: 'In the past 12 months, have you ever been unable to get your medications due to cost?',
    zCode: 'Z59.7',
    zCodeDescription: 'Insufficient social insurance and welfare support',
  },
  {
    id: 'transportation_barrier',
    text: 'In the past 12 months, has lack of transportation kept you from medical appointments or getting medications?',
    zCode: 'Z59.8',
    zCodeDescription: 'Other problems related to housing and economic circumstances',
  },
] as const;
