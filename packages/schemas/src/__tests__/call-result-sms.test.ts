import { CallResultSchema } from '../call-result';

const baseValid = {
  call_id: 'CALL-abc123',
  patient_id: 'PAT-001',
  variables: {},
  sdoh_responses: { medication_cost_barrier: false, transportation_barrier: false, z_codes: [] },
  triage_status: 'INCOMPLETE' as const,
  created_at: '2026-03-27T10:00:00.000Z',
};

describe('CallResultSchema — SMS fields', () => {
  describe('call_status', () => {
    it('accepts INCOMPLETE', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, call_status: 'INCOMPLETE' })).not.toThrow();
    });

    it('accepts COMPLETE', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, call_status: 'COMPLETE' })).not.toThrow();
    });

    it('accepts FAILED', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, call_status: 'FAILED' })).not.toThrow();
    });

    it('rejects unknown status', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, call_status: 'BOUNCED' })).toThrow();
    });

    it('is valid when absent', () => {
      expect(() => CallResultSchema.parse(baseValid)).not.toThrow();
    });

    it('rejects non-string value', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, call_status: 42 })).toThrow();
    });
  });

  describe('sms_sent', () => {
    it('accepts true', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_sent: true })).not.toThrow();
    });

    it('accepts false', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_sent: false })).not.toThrow();
    });

    it('is valid when absent', () => {
      expect(() => CallResultSchema.parse(baseValid)).not.toThrow();
    });

    it('rejects non-boolean value', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_sent: 'yes' })).toThrow();
    });

    it('rejects numeric value', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_sent: 1 })).toThrow();
    });
  });

  describe('sms_sent_at', () => {
    it('accepts ISO timestamp string', () => {
      expect(() =>
        CallResultSchema.parse({ ...baseValid, sms_sent_at: '2026-03-27T10:05:00.000Z' }),
      ).not.toThrow();
    });

    it('is valid when absent', () => {
      expect(() => CallResultSchema.parse(baseValid)).not.toThrow();
    });

    it('rejects non-string value', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_sent_at: 1711533600000 })).toThrow();
    });
  });

  describe('sms_question_index', () => {
    it('accepts 0', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_question_index: 0 })).not.toThrow();
    });

    it('accepts 1', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_question_index: 1 })).not.toThrow();
    });

    it('accepts 2', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_question_index: 2 })).not.toThrow();
    });

    it('is valid when absent', () => {
      expect(() => CallResultSchema.parse(baseValid)).not.toThrow();
    });

    it('rejects negative integer', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_question_index: -1 })).toThrow();
    });

    it('rejects float', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_question_index: 1.5 })).toThrow();
    });

    it('rejects string', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_question_index: '0' })).toThrow();
    });
  });

  describe('sms_protocol_id', () => {
    it('accepts a non-empty string', () => {
      expect(() =>
        CallResultSchema.parse({ ...baseValid, sms_protocol_id: 'proto-001' }),
      ).not.toThrow();
    });

    it('is valid when absent', () => {
      expect(() => CallResultSchema.parse(baseValid)).not.toThrow();
    });

    it('rejects non-string value', () => {
      expect(() => CallResultSchema.parse({ ...baseValid, sms_protocol_id: 123 })).toThrow();
    });
  });

  describe('all SMS fields together', () => {
    it('accepts a fully-populated SMS record', () => {
      const result = CallResultSchema.parse({
        ...baseValid,
        call_status: 'INCOMPLETE',
        sms_sent: true,
        sms_sent_at: '2026-03-27T10:05:00.000Z',
        sms_question_index: 1,
        sms_protocol_id: 'proto-chf-001',
      });
      expect(result.call_status).toBe('INCOMPLETE');
      expect(result.sms_sent).toBe(true);
      expect(result.sms_sent_at).toBe('2026-03-27T10:05:00.000Z');
      expect(result.sms_question_index).toBe(1);
      expect(result.sms_protocol_id).toBe('proto-chf-001');
    });

    it('existing required fields still required with SMS fields present', () => {
      expect(() =>
        CallResultSchema.parse({
          call_status: 'INCOMPLETE',
          sms_sent: true,
          sms_sent_at: '2026-03-27T10:05:00.000Z',
        }),
      ).toThrow();
    });
  });
});
