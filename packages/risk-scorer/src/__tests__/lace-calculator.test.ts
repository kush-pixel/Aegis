import { calcLaceScore } from '../lace-calculator';

describe('calcLaceScore', () => {
  // ── length_of_stay_days capping ─────────────────────────────────────────────

  describe('length_of_stay_days capping', () => {
    it('returns length_of_stay=0 when days=0', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.length_of_stay).toBe(0);
    });

    it('returns length_of_stay=7 when days=7 (no capping needed)', () => {
      const result = calcLaceScore({
        length_of_stay_days: 7,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.length_of_stay).toBe(7);
    });

    it('caps length_of_stay at 7 when days=10', () => {
      const result = calcLaceScore({
        length_of_stay_days: 10,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.length_of_stay).toBe(7);
    });
  });

  // ── acuity_emergent both branches ───────────────────────────────────────────

  describe('acuity_emergent scoring', () => {
    it('returns acuity=3 when acuity_emergent=true', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: true,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.acuity).toBe(3);
    });

    it('returns acuity=0 when acuity_emergent=false', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.acuity).toBe(0);
    });
  });

  // ── charlson_index capping ──────────────────────────────────────────────────

  describe('charlson_index capping', () => {
    it('returns comorbidity=0 when charlson_index=0', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.comorbidity).toBe(0);
    });

    it('returns comorbidity=5 when charlson_index=5 (no capping needed)', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 5,
        ed_visits_6mo: 0,
      });
      expect(result.comorbidity).toBe(5);
    });

    it('caps comorbidity at 5 when charlson_index=8', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 8,
        ed_visits_6mo: 0,
      });
      expect(result.comorbidity).toBe(5);
    });
  });

  // ── ed_visits_6mo capping ───────────────────────────────────────────────────

  describe('ed_visits_6mo capping', () => {
    it('returns ed_visits=0 when ed_visits_6mo=0', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.ed_visits).toBe(0);
    });

    it('returns ed_visits=4 when ed_visits_6mo=4 (no capping needed)', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 4,
      });
      expect(result.ed_visits).toBe(4);
    });

    it('caps ed_visits at 4 when ed_visits_6mo=6', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 6,
      });
      expect(result.ed_visits).toBe(4);
    });
  });

  // ── risk_level boundaries ───────────────────────────────────────────────────

  describe('risk_level boundaries', () => {
    it('returns risk_level=LOW when total=0', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.total).toBe(0);
      expect(result.risk_level).toBe('LOW');
    });

    it('returns risk_level=LOW when total=4', () => {
      // days=4, emergent=false, charlson=0, ed=0 → total=4
      const result = calcLaceScore({
        length_of_stay_days: 4,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.total).toBe(4);
      expect(result.risk_level).toBe('LOW');
    });

    it('returns risk_level=MODERATE when total=5', () => {
      // days=5, emergent=false, charlson=0, ed=0 → total=5
      const result = calcLaceScore({
        length_of_stay_days: 5,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result.total).toBe(5);
      expect(result.risk_level).toBe('MODERATE');
    });

    it('returns risk_level=MODERATE when total=9', () => {
      // days=6, emergent=false, charlson=3, ed=0 → total=9
      const result = calcLaceScore({
        length_of_stay_days: 6,
        acuity_emergent: false,
        charlson_index: 3,
        ed_visits_6mo: 0,
      });
      expect(result.total).toBe(9);
      expect(result.risk_level).toBe('MODERATE');
    });

    it('returns risk_level=HIGH when total=10', () => {
      // days=7, emergent=false, charlson=3, ed=0 → total=10
      const result = calcLaceScore({
        length_of_stay_days: 7,
        acuity_emergent: false,
        charlson_index: 3,
        ed_visits_6mo: 0,
      });
      expect(result.total).toBe(10);
      expect(result.risk_level).toBe('HIGH');
    });

    it('returns risk_level=HIGH when total=19', () => {
      const result = calcLaceScore({
        length_of_stay_days: 20,
        acuity_emergent: true,
        charlson_index: 10,
        ed_visits_6mo: 10,
      });
      expect(result.total).toBe(19);
      expect(result.risk_level).toBe('HIGH');
    });
  });

  // ── full scenario tests ─────────────────────────────────────────────────────

  describe('full scenario: minimum score', () => {
    it('returns total=0 and LOW for all-zero inputs', () => {
      const result = calcLaceScore({
        length_of_stay_days: 0,
        acuity_emergent: false,
        charlson_index: 0,
        ed_visits_6mo: 0,
      });
      expect(result).toEqual({
        length_of_stay: 0,
        acuity: 0,
        comorbidity: 0,
        ed_visits: 0,
        total: 0,
        risk_level: 'LOW',
      });
    });
  });

  describe('full scenario: maximum score', () => {
    it('returns total=19 and HIGH when days=20, emergent=true, charlson=10, ed=10', () => {
      const result = calcLaceScore({
        length_of_stay_days: 20,
        acuity_emergent: true,
        charlson_index: 10,
        ed_visits_6mo: 10,
      });
      expect(result).toEqual({
        length_of_stay: 7,
        acuity: 3,
        comorbidity: 5,
        ed_visits: 4,
        total: 19,
        risk_level: 'HIGH',
      });
    });
  });

  // ── input validation ────────────────────────────────────────────────────────

  describe('input validation', () => {
    it('throws when length_of_stay_days is negative', () => {
      expect(() =>
        calcLaceScore({
          length_of_stay_days: -1,
          acuity_emergent: false,
          charlson_index: 0,
          ed_visits_6mo: 0,
        }),
      ).toThrow();
    });

    it('throws when charlson_index is negative', () => {
      expect(() =>
        calcLaceScore({
          length_of_stay_days: 0,
          acuity_emergent: false,
          charlson_index: -1,
          ed_visits_6mo: 0,
        }),
      ).toThrow();
    });

    it('throws when acuity_emergent is not a boolean', () => {
      expect(() =>
        calcLaceScore({
          length_of_stay_days: 0,
          acuity_emergent: 'yes' as unknown as boolean,
          charlson_index: 0,
          ed_visits_6mo: 0,
        }),
      ).toThrow();
    });

    it('throws when ed_visits_6mo is negative', () => {
      expect(() =>
        calcLaceScore({
          length_of_stay_days: 0,
          acuity_emergent: false,
          charlson_index: 0,
          ed_visits_6mo: -1,
        }),
      ).toThrow();
    });
  });
});
