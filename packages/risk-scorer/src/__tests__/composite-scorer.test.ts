import { calcCompositeRisk } from '../composite-scorer';

// All achievable composite scores skip 29/30 and 79/80 as exact integers.
// Boundary mapping (from scanning all valid lace+hospital combos):
//   composite < 30  → LOW     (max achievable below 30 is 28: lace=9, hospital=0)
//   30 <= c < 60    → MODERATE (min achievable >= 30 is 31: lace=10, hospital=0 → 32;
//                               max achievable < 60 is 59: lace=9, hospital=10)
//   60 <= c < 80    → HIGH    (min achievable >= 60 is 60: lace=19, hospital=0;
//                               max achievable < 80 is 78: lace=12, hospital=13)
//   c >= 80         → VERY_HIGH (min achievable >= 80 is 81: lace=13, hospital=13)

describe('calcCompositeRisk', () => {
  // ── min and max scores ──────────────────────────────────────────────────────

  describe('minimum inputs (0, 0)', () => {
    it('returns composite_score=0, lace_risk_level=LOW, hospital_risk_level=LOW, risk_level=LOW', () => {
      const result = calcCompositeRisk({ lace_score: 0, hospital_score: 0 });
      expect(result).toEqual({
        lace_score: 0,
        lace_risk_level: 'LOW',
        hospital_score: 0,
        hospital_risk_level: 'LOW',
        composite_score: 0,
        risk_level: 'LOW',
      });
    });
  });

  describe('maximum inputs (19, 13)', () => {
    it('returns composite_score=100, lace_risk_level=HIGH, hospital_risk_level=HIGH, risk_level=VERY_HIGH', () => {
      const result = calcCompositeRisk({ lace_score: 19, hospital_score: 13 });
      expect(result).toEqual({
        lace_score: 19,
        lace_risk_level: 'HIGH',
        hospital_score: 13,
        hospital_risk_level: 'HIGH',
        composite_score: 100,
        risk_level: 'VERY_HIGH',
      });
    });
  });

  // ── LACE risk level sub-classification boundaries ───────────────────────────

  describe('lace_risk_level boundaries', () => {
    it('returns lace_risk_level=LOW when lace_score=4', () => {
      const result = calcCompositeRisk({ lace_score: 4, hospital_score: 0 });
      expect(result.lace_risk_level).toBe('LOW');
    });

    it('returns lace_risk_level=MODERATE when lace_score=5', () => {
      const result = calcCompositeRisk({ lace_score: 5, hospital_score: 0 });
      expect(result.lace_risk_level).toBe('MODERATE');
    });

    it('returns lace_risk_level=MODERATE when lace_score=9', () => {
      const result = calcCompositeRisk({ lace_score: 9, hospital_score: 0 });
      expect(result.lace_risk_level).toBe('MODERATE');
    });

    it('returns lace_risk_level=HIGH when lace_score=10', () => {
      const result = calcCompositeRisk({ lace_score: 10, hospital_score: 0 });
      expect(result.lace_risk_level).toBe('HIGH');
    });
  });

  // ── HOSPITAL risk level sub-classification boundaries ───────────────────────

  describe('hospital_risk_level boundaries', () => {
    it('returns hospital_risk_level=LOW when hospital_score=4', () => {
      const result = calcCompositeRisk({ lace_score: 0, hospital_score: 4 });
      expect(result.hospital_risk_level).toBe('LOW');
    });

    it('returns hospital_risk_level=INTERMEDIATE when hospital_score=5', () => {
      const result = calcCompositeRisk({ lace_score: 0, hospital_score: 5 });
      expect(result.hospital_risk_level).toBe('INTERMEDIATE');
    });

    it('returns hospital_risk_level=INTERMEDIATE when hospital_score=6', () => {
      const result = calcCompositeRisk({ lace_score: 0, hospital_score: 6 });
      expect(result.hospital_risk_level).toBe('INTERMEDIATE');
    });

    it('returns hospital_risk_level=HIGH when hospital_score=7', () => {
      const result = calcCompositeRisk({ lace_score: 0, hospital_score: 7 });
      expect(result.hospital_risk_level).toBe('HIGH');
    });
  });

  // ── composite risk_level boundaries ────────────────────────────────────────

  describe('composite risk_level=LOW (composite_score < 30)', () => {
    it('returns risk_level=LOW when lace=0, hospital=0 → composite=0', () => {
      const result = calcCompositeRisk({ lace_score: 0, hospital_score: 0 });
      expect(result.composite_score).toBe(0);
      expect(result.risk_level).toBe('LOW');
    });

    it('returns risk_level=LOW when lace=9, hospital=0 → composite=28', () => {
      const result = calcCompositeRisk({ lace_score: 9, hospital_score: 0 });
      expect(result.composite_score).toBe(28);
      expect(result.risk_level).toBe('LOW');
    });
  });

  describe('composite risk_level=MODERATE (30 <= composite_score < 60)', () => {
    it('returns risk_level=MODERATE when lace=10, hospital=0 → composite=32', () => {
      const result = calcCompositeRisk({ lace_score: 10, hospital_score: 0 });
      expect(result.composite_score).toBe(32);
      expect(result.risk_level).toBe('MODERATE');
    });

    it('returns risk_level=MODERATE when lace=9, hospital=10 → composite=59', () => {
      const result = calcCompositeRisk({ lace_score: 9, hospital_score: 10 });
      expect(result.composite_score).toBe(59);
      expect(result.risk_level).toBe('MODERATE');
    });
  });

  describe('composite risk_level=HIGH (60 <= composite_score < 80)', () => {
    it('returns risk_level=HIGH when lace=19, hospital=0 → composite=60', () => {
      const result = calcCompositeRisk({ lace_score: 19, hospital_score: 0 });
      expect(result.composite_score).toBe(60);
      expect(result.risk_level).toBe('HIGH');
    });

    it('returns risk_level=HIGH when lace=12, hospital=13 → composite=78', () => {
      const result = calcCompositeRisk({ lace_score: 12, hospital_score: 13 });
      expect(result.composite_score).toBe(78);
      expect(result.risk_level).toBe('HIGH');
    });
  });

  describe('composite risk_level=VERY_HIGH (composite_score >= 80)', () => {
    it('returns risk_level=VERY_HIGH when lace=13, hospital=13 → composite=81', () => {
      const result = calcCompositeRisk({ lace_score: 13, hospital_score: 13 });
      expect(result.composite_score).toBe(81);
      expect(result.risk_level).toBe('VERY_HIGH');
    });

    it('returns risk_level=VERY_HIGH when lace=19, hospital=13 → composite=100', () => {
      const result = calcCompositeRisk({ lace_score: 19, hospital_score: 13 });
      expect(result.composite_score).toBe(100);
      expect(result.risk_level).toBe('VERY_HIGH');
    });
  });

  // ── input validation ────────────────────────────────────────────────────────

  describe('input validation', () => {
    it('throws when lace_score=20 (exceeds max of 19)', () => {
      expect(() =>
        calcCompositeRisk({ lace_score: 20, hospital_score: 0 }),
      ).toThrow();
    });

    it('throws when hospital_score=14 (exceeds max of 13)', () => {
      expect(() =>
        calcCompositeRisk({ lace_score: 0, hospital_score: 14 }),
      ).toThrow();
    });

    it('throws when lace_score is negative', () => {
      expect(() =>
        calcCompositeRisk({ lace_score: -1, hospital_score: 0 }),
      ).toThrow();
    });

    it('throws when hospital_score is negative', () => {
      expect(() =>
        calcCompositeRisk({ lace_score: 0, hospital_score: -1 }),
      ).toThrow();
    });
  });
});
