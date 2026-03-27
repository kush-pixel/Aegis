import { SdohScreeningSchema } from '@aegis/schemas';
import { PRAPARE_QUESTIONS } from '../questions';
import type { SdohQuestion } from '../questions';
import { mapResponsesToZCodes } from '../map-responses';
import type { SdohResponses } from '../map-responses';

// ---------------------------------------------------------------------------
// PRAPARE_QUESTIONS
// ---------------------------------------------------------------------------

describe('PRAPARE_QUESTIONS', () => {
  describe('array shape', () => {
    it('contains exactly 2 questions', () => {
      expect(PRAPARE_QUESTIONS).toHaveLength(2);
    });

    it('every element has the required SdohQuestion fields', () => {
      for (const q of PRAPARE_QUESTIONS) {
        expect(q).toHaveProperty('id');
        expect(q).toHaveProperty('text');
        expect(q).toHaveProperty('zCode');
        expect(q).toHaveProperty('zCodeDescription');
      }
    });
  });

  describe('medication_cost_barrier question', () => {
    let question: SdohQuestion;

    beforeAll(() => {
      const found = PRAPARE_QUESTIONS.find(q => q.id === 'medication_cost_barrier');
      if (!found) throw new Error('medication_cost_barrier question not found');
      question = found;
    });

    it('has id "medication_cost_barrier"', () => {
      expect(question.id).toBe('medication_cost_barrier');
    });

    it('has zCode Z59.7', () => {
      expect(question.zCode).toBe('Z59.7');
    });

    it('has the correct question text', () => {
      expect(question.text).toBe(
        'In the past 12 months, have you ever been unable to get your medications due to cost?',
      );
    });

    it('has zCodeDescription "Insufficient social insurance and welfare support"', () => {
      expect(question.zCodeDescription).toBe(
        'Insufficient social insurance and welfare support',
      );
    });
  });

  describe('transportation_barrier question', () => {
    let question: SdohQuestion;

    beforeAll(() => {
      const found = PRAPARE_QUESTIONS.find(q => q.id === 'transportation_barrier');
      if (!found) throw new Error('transportation_barrier question not found');
      question = found;
    });

    it('has id "transportation_barrier"', () => {
      expect(question.id).toBe('transportation_barrier');
    });

    it('has zCode Z59.8', () => {
      expect(question.zCode).toBe('Z59.8');
    });

    it('has the correct question text', () => {
      expect(question.text).toBe(
        'In the past 12 months, has lack of transportation kept you from medical appointments or getting medications?',
      );
    });

    it('has zCodeDescription "Other problems related to housing and economic circumstances"', () => {
      expect(question.zCodeDescription).toBe(
        'Other problems related to housing and economic circumstances',
      );
    });
  });
});

// ---------------------------------------------------------------------------
// mapResponsesToZCodes
// ---------------------------------------------------------------------------

describe('mapResponsesToZCodes', () => {
  describe('when both barriers are true', () => {
    const responses: SdohResponses = {
      medication_cost_barrier: true,
      transportation_barrier: true,
    };

    it('returns medication_cost_barrier as true', () => {
      expect(mapResponsesToZCodes(responses).medication_cost_barrier).toBe(true);
    });

    it('returns transportation_barrier as true', () => {
      expect(mapResponsesToZCodes(responses).transportation_barrier).toBe(true);
    });

    it('returns both Z-codes in z_codes', () => {
      expect(mapResponsesToZCodes(responses).z_codes).toEqual(['Z59.7', 'Z59.8']);
    });

    it('returns z_codes with exactly 2 entries', () => {
      expect(mapResponsesToZCodes(responses).z_codes).toHaveLength(2);
    });
  });

  describe('when both barriers are false', () => {
    const responses: SdohResponses = {
      medication_cost_barrier: false,
      transportation_barrier: false,
    };

    it('returns medication_cost_barrier as false', () => {
      expect(mapResponsesToZCodes(responses).medication_cost_barrier).toBe(false);
    });

    it('returns transportation_barrier as false', () => {
      expect(mapResponsesToZCodes(responses).transportation_barrier).toBe(false);
    });

    it('returns an empty z_codes array', () => {
      expect(mapResponsesToZCodes(responses).z_codes).toEqual([]);
    });
  });

  describe('when only medication_cost_barrier is true', () => {
    const responses: SdohResponses = {
      medication_cost_barrier: true,
      transportation_barrier: false,
    };

    it('returns medication_cost_barrier as true', () => {
      expect(mapResponsesToZCodes(responses).medication_cost_barrier).toBe(true);
    });

    it('returns transportation_barrier as false', () => {
      expect(mapResponsesToZCodes(responses).transportation_barrier).toBe(false);
    });

    it('returns only Z59.7 in z_codes', () => {
      expect(mapResponsesToZCodes(responses).z_codes).toEqual(['Z59.7']);
    });

    it('does not include Z59.8 in z_codes', () => {
      expect(mapResponsesToZCodes(responses).z_codes).not.toContain('Z59.8');
    });
  });

  describe('when only transportation_barrier is true', () => {
    const responses: SdohResponses = {
      medication_cost_barrier: false,
      transportation_barrier: true,
    };

    it('returns medication_cost_barrier as false', () => {
      expect(mapResponsesToZCodes(responses).medication_cost_barrier).toBe(false);
    });

    it('returns transportation_barrier as true', () => {
      expect(mapResponsesToZCodes(responses).transportation_barrier).toBe(true);
    });

    it('returns only Z59.8 in z_codes', () => {
      expect(mapResponsesToZCodes(responses).z_codes).toEqual(['Z59.8']);
    });

    it('does not include Z59.7 in z_codes', () => {
      expect(mapResponsesToZCodes(responses).z_codes).not.toContain('Z59.7');
    });
  });

  describe('return value matches SdohScreening schema shape', () => {
    it('passes SdohScreeningSchema.parse for both-true case', () => {
      const result = mapResponsesToZCodes({
        medication_cost_barrier: true,
        transportation_barrier: true,
      });
      expect(() => SdohScreeningSchema.parse(result)).not.toThrow();
    });

    it('passes SdohScreeningSchema.parse for both-false case', () => {
      const result = mapResponsesToZCodes({
        medication_cost_barrier: false,
        transportation_barrier: false,
      });
      expect(() => SdohScreeningSchema.parse(result)).not.toThrow();
    });

    it('passes SdohScreeningSchema.parse for medication-only case', () => {
      const result = mapResponsesToZCodes({
        medication_cost_barrier: true,
        transportation_barrier: false,
      });
      expect(() => SdohScreeningSchema.parse(result)).not.toThrow();
    });

    it('passes SdohScreeningSchema.parse for transportation-only case', () => {
      const result = mapResponsesToZCodes({
        medication_cost_barrier: false,
        transportation_barrier: true,
      });
      expect(() => SdohScreeningSchema.parse(result)).not.toThrow();
    });

    it('z_codes field is always an array of strings', () => {
      const result = mapResponsesToZCodes({
        medication_cost_barrier: true,
        transportation_barrier: true,
      });
      expect(Array.isArray(result.z_codes)).toBe(true);
      for (const code of result.z_codes) {
        expect(typeof code).toBe('string');
      }
    });
  });
});
