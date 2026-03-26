import { LaceScoreSchema } from '../lace-score';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Asserts that parsing throws a ZodError (or any error). */
const expectInvalid = (fn: () => unknown): void => {
  expect(fn).toThrow();
};

// ---------------------------------------------------------------------------
// LaceScoreSchema
// ---------------------------------------------------------------------------

describe('LaceScoreSchema', () => {
  // -------------------------------------------------------------------------
  // Valid cases
  // -------------------------------------------------------------------------

  test('valid: all fields at minimum (total=0, risk_level=LOW)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 0,
      acuity: 0,
      comorbidity: 0,
      ed_visits: 0,
      total: 0,
      risk_level: 'LOW',
    });
    expect(result.total).toBe(0);
    expect(result.risk_level).toBe('LOW');
  });

  test('valid: all fields at maximum (total=19, risk_level=HIGH)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 7,
      acuity: 3,
      comorbidity: 5,
      ed_visits: 4,
      total: 19,
      risk_level: 'HIGH',
    });
    expect(result.total).toBe(19);
    expect(result.risk_level).toBe('HIGH');
  });

  test('valid: acuity=0 (non-emergent)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 2,
      acuity: 0,
      comorbidity: 1,
      ed_visits: 1,
      total: 4,
      risk_level: 'LOW',
    });
    expect(result.acuity).toBe(0);
  });

  test('valid: acuity=3 (emergent)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 2,
      acuity: 3,
      comorbidity: 1,
      ed_visits: 1,
      total: 7,
      risk_level: 'MODERATE',
    });
    expect(result.acuity).toBe(3);
  });

  test('valid: MODERATE risk (total=5)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 2,
      acuity: 0,
      comorbidity: 2,
      ed_visits: 1,
      total: 5,
      risk_level: 'MODERATE',
    });
    expect(result.risk_level).toBe('MODERATE');
    expect(result.total).toBe(5);
  });

  test('valid: boundary total=9 (still MODERATE)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 4,
      acuity: 0,
      comorbidity: 3,
      ed_visits: 2,
      total: 9,
      risk_level: 'MODERATE',
    });
    expect(result.total).toBe(9);
    expect(result.risk_level).toBe('MODERATE');
  });

  test('valid: boundary total=10 (HIGH)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 4,
      acuity: 3,
      comorbidity: 2,
      ed_visits: 1,
      total: 10,
      risk_level: 'HIGH',
    });
    expect(result.total).toBe(10);
    expect(result.risk_level).toBe('HIGH');
  });

  test('valid: length_of_stay at max boundary (7)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 7,
      acuity: 0,
      comorbidity: 0,
      ed_visits: 0,
      total: 7,
      risk_level: 'MODERATE',
    });
    expect(result.length_of_stay).toBe(7);
  });

  test('valid: comorbidity at max boundary (5)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 1,
      acuity: 0,
      comorbidity: 5,
      ed_visits: 0,
      total: 6,
      risk_level: 'MODERATE',
    });
    expect(result.comorbidity).toBe(5);
  });

  test('valid: ed_visits at max boundary (4)', () => {
    const result = LaceScoreSchema.parse({
      length_of_stay: 1,
      acuity: 0,
      comorbidity: 0,
      ed_visits: 4,
      total: 5,
      risk_level: 'MODERATE',
    });
    expect(result.ed_visits).toBe(4);
  });

  // -------------------------------------------------------------------------
  // Invalid cases
  // -------------------------------------------------------------------------

  test('invalid: length_of_stay=8 (exceeds max 7)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 8,
        acuity: 0,
        comorbidity: 0,
        ed_visits: 0,
        total: 8,
        risk_level: 'MODERATE',
      })
    );
  });

  test('invalid: length_of_stay=-1 (below min 0)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: -1,
        acuity: 0,
        comorbidity: 0,
        ed_visits: 0,
        total: 0,
        risk_level: 'LOW',
      })
    );
  });

  test('invalid: acuity=1 (not 0 or 3)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 1,
        acuity: 1,
        comorbidity: 0,
        ed_visits: 0,
        total: 2,
        risk_level: 'LOW',
      })
    );
  });

  test('invalid: acuity=2 (not 0 or 3)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 1,
        acuity: 2,
        comorbidity: 0,
        ed_visits: 0,
        total: 3,
        risk_level: 'LOW',
      })
    );
  });

  test('invalid: comorbidity=6 (exceeds max 5)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 1,
        acuity: 0,
        comorbidity: 6,
        ed_visits: 0,
        total: 7,
        risk_level: 'MODERATE',
      })
    );
  });

  test('invalid: comorbidity=-1 (below min 0)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 1,
        acuity: 0,
        comorbidity: -1,
        ed_visits: 0,
        total: 0,
        risk_level: 'LOW',
      })
    );
  });

  test('invalid: ed_visits=5 (exceeds max 4)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 1,
        acuity: 0,
        comorbidity: 0,
        ed_visits: 5,
        total: 6,
        risk_level: 'MODERATE',
      })
    );
  });

  test('invalid: ed_visits=-1 (below min 0)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 1,
        acuity: 0,
        comorbidity: 0,
        ed_visits: -1,
        total: 0,
        risk_level: 'LOW',
      })
    );
  });

  test('invalid: total=20 (exceeds max 19)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 7,
        acuity: 3,
        comorbidity: 5,
        ed_visits: 4,
        total: 20,
        risk_level: 'HIGH',
      })
    );
  });

  test('invalid: total=-1 (below min 0)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 0,
        acuity: 0,
        comorbidity: 0,
        ed_visits: 0,
        total: -1,
        risk_level: 'LOW',
      })
    );
  });

  test("invalid: risk_level='VERY_HIGH' (not in enum)", () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 5,
        acuity: 3,
        comorbidity: 4,
        ed_visits: 3,
        total: 15,
        risk_level: 'VERY_HIGH',
      })
    );
  });

  test('invalid: missing total field', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 2,
        acuity: 0,
        comorbidity: 1,
        ed_visits: 1,
        risk_level: 'LOW',
      })
    );
  });

  test('invalid: missing risk_level field', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 2,
        acuity: 0,
        comorbidity: 1,
        ed_visits: 1,
        total: 4,
      })
    );
  });

  test('invalid: length_of_stay is a float (not int)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 1.5,
        acuity: 0,
        comorbidity: 0,
        ed_visits: 0,
        total: 1,
        risk_level: 'LOW',
      })
    );
  });

  test('invalid: total is a float (not int)', () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 1,
        acuity: 0,
        comorbidity: 0,
        ed_visits: 0,
        total: 1.5,
        risk_level: 'LOW',
      })
    );
  });

  test("invalid: risk_level='LOW' spelled lowercase", () => {
    expectInvalid(() =>
      LaceScoreSchema.parse({
        length_of_stay: 1,
        acuity: 0,
        comorbidity: 0,
        ed_visits: 0,
        total: 1,
        risk_level: 'low',
      })
    );
  });
});
