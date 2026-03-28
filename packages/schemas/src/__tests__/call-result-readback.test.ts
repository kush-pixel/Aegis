import { CallResultSchema } from '../call-result';

const baseValid = {
  call_id: 'CALL-abc123',
  patient_id: 'PAT-001',
  variables: {},
  sdoh_responses: { medication_cost_barrier: false, transportation_barrier: false, z_codes: [] },
  triage_status: 'INCOMPLETE' as const,
  created_at: '2026-03-28T10:00:00.000Z',
};

describe('CallResultSchema — read-back fields', () => {
  describe('read_back', () => {
    it('accepts a non-empty string', () => {
      expect(() =>
        CallResultSchema.parse({ ...baseValid, read_back: 'Patient confirmed all discharge instructions.' }),
      ).not.toThrow();
    });

    it('accepts the GREEN auto-populated string', () => {
      expect(() =>
        CallResultSchema.parse({
          ...baseValid,
          read_back: 'No callback required — patient stable and recovering as expected.',
        }),
      ).not.toThrow();
    });

    it('is valid when absent', () => {
      expect(() => CallResultSchema.parse(baseValid)).not.toThrow();
    });

    it('rejects a numeric value', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, read_back: 42 })).toThrow();
    });

    it('rejects a boolean value', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, read_back: true })).toThrow();
    });
  });

  describe('read_back_documented_at', () => {
    it('accepts an ISO timestamp string', () => {
      expect(() =>
        CallResultSchema.parse({
          ...baseValid,
          read_back_documented_at: '2026-03-28T10:05:00.000Z',
        }),
      ).not.toThrow();
    });

    it('is valid when absent', () => {
      expect(() => CallResultSchema.parse(baseValid)).not.toThrow();
    });

    it('rejects a numeric value', () => {
      expect(() =>
        CallResultSchema.parse({ ...baseValid, read_back_documented_at: 1711533600000 }),
      ).toThrow();
    });

    it('rejects a boolean value', () => {
      expect(() =>
        CallResultSchema.parse({ ...baseValid, read_back_documented_at: false }),
      ).toThrow();
    });
  });

  describe('all read-back fields together', () => {
    it('accepts a fully-populated read-back record', () => {
      const result = CallResultSchema.parse({
        ...baseValid,
        read_back: 'Patient confirmed all discharge instructions and follow-up appointment.',
        read_back_documented_at: '2026-03-28T10:05:00.000Z',
      });
      expect(result.read_back).toBe(
        'Patient confirmed all discharge instructions and follow-up appointment.',
      );
      expect(result.read_back_documented_at).toBe('2026-03-28T10:05:00.000Z');
    });

    it('existing required fields still required with read-back fields present', () => {
      expect(() =>
        CallResultSchema.parse({
          read_back: 'Some read-back text for the patient.',
          read_back_documented_at: '2026-03-28T10:05:00.000Z',
        }),
      ).toThrow();
    });
  });
});
