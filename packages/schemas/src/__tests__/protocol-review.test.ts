import { ProtocolReviewSchema } from '../protocol-review';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const expectInvalid = (fn: () => unknown): void => {
  expect(fn).toThrow();
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const validBase = {
  review_id:        'review-001',
  patient_id:       'patient-abc',
  protocol_id:      'proto-001',
  status:           'PENDING' as const,
  confidence_score: 0.5,
  created_at:       '2026-03-27T00:00:00.000Z',
};

// ---------------------------------------------------------------------------
// ProtocolReviewSchema
// ---------------------------------------------------------------------------

describe('ProtocolReviewSchema', () => {
  // -------------------------------------------------------------------------
  // Valid cases
  // -------------------------------------------------------------------------

  test('valid: status PENDING', () => {
    const result = ProtocolReviewSchema.parse({ ...validBase, status: 'PENDING' });
    expect(result.status).toBe('PENDING');
  });

  test('valid: status APPROVED', () => {
    const result = ProtocolReviewSchema.parse({ ...validBase, status: 'APPROVED' });
    expect(result.status).toBe('APPROVED');
  });

  test('valid: status AUTO_APPROVED', () => {
    const result = ProtocolReviewSchema.parse({ ...validBase, status: 'AUTO_APPROVED' });
    expect(result.status).toBe('AUTO_APPROVED');
  });

  test('valid: confidence_score at boundary 0', () => {
    const result = ProtocolReviewSchema.parse({ ...validBase, confidence_score: 0 });
    expect(result.confidence_score).toBe(0);
  });

  test('valid: confidence_score at boundary 1', () => {
    const result = ProtocolReviewSchema.parse({ ...validBase, confidence_score: 1 });
    expect(result.confidence_score).toBe(1);
  });

  test('valid: all fields present and correctly typed', () => {
    const result = ProtocolReviewSchema.parse(validBase);
    expect(result.review_id).toBe('review-001');
    expect(result.patient_id).toBe('patient-abc');
    expect(result.protocol_id).toBe('proto-001');
    expect(result.created_at).toBe('2026-03-27T00:00:00.000Z');
  });

  // -------------------------------------------------------------------------
  // Invalid — empty string fields
  // -------------------------------------------------------------------------

  test('invalid: review_id empty string', () => {
    expectInvalid(() => ProtocolReviewSchema.parse({ ...validBase, review_id: '' }));
  });

  test('invalid: patient_id empty string', () => {
    expectInvalid(() => ProtocolReviewSchema.parse({ ...validBase, patient_id: '' }));
  });

  test('invalid: protocol_id empty string', () => {
    expectInvalid(() => ProtocolReviewSchema.parse({ ...validBase, protocol_id: '' }));
  });

  test('invalid: created_at empty string', () => {
    expectInvalid(() => ProtocolReviewSchema.parse({ ...validBase, created_at: '' }));
  });

  // -------------------------------------------------------------------------
  // Invalid — status enum
  // -------------------------------------------------------------------------

  test("invalid: status 'REJECTED' not in enum", () => {
    expectInvalid(() => ProtocolReviewSchema.parse({ ...validBase, status: 'REJECTED' }));
  });

  test("invalid: status 'pending' lowercase", () => {
    expectInvalid(() => ProtocolReviewSchema.parse({ ...validBase, status: 'pending' }));
  });

  // -------------------------------------------------------------------------
  // Invalid — confidence_score bounds
  // -------------------------------------------------------------------------

  test('invalid: confidence_score above 1 (1.01)', () => {
    expectInvalid(() => ProtocolReviewSchema.parse({ ...validBase, confidence_score: 1.01 }));
  });

  test('invalid: confidence_score below 0 (-0.01)', () => {
    expectInvalid(() => ProtocolReviewSchema.parse({ ...validBase, confidence_score: -0.01 }));
  });

  // -------------------------------------------------------------------------
  // Invalid — missing required fields
  // -------------------------------------------------------------------------

  test('invalid: missing review_id', () => {
    const { review_id: _, ...rest } = validBase;
    expectInvalid(() => ProtocolReviewSchema.parse(rest));
  });

  test('invalid: missing status', () => {
    const { status: _, ...rest } = validBase;
    expectInvalid(() => ProtocolReviewSchema.parse(rest));
  });

  test('invalid: missing patient_id', () => {
    const { patient_id: _, ...rest } = validBase;
    expectInvalid(() => ProtocolReviewSchema.parse(rest));
  });
});
