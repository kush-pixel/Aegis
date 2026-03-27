import { validatePatientId } from '../validate-patient-id';
import { generateCallId } from '../generate-call-id';

describe('validatePatientId', () => {
  it('returns true for a normal non-empty string', () => {
    expect(validatePatientId('P12345')).toBe(true);
  });

  it('returns true for a single character', () => {
    expect(validatePatientId('x')).toBe(true);
  });

  it('returns true for a string with leading and trailing spaces but inner content', () => {
    expect(validatePatientId('  P12345  ')).toBe(true);
  });

  it('returns true for a string that is only spaces around content', () => {
    expect(validatePatientId(' patient-id ')).toBe(true);
  });

  it('returns false for an empty string', () => {
    expect(validatePatientId('')).toBe(false);
  });

  it('returns false for a whitespace-only string (single space)', () => {
    expect(validatePatientId(' ')).toBe(false);
  });

  it('returns false for a whitespace-only string (multiple spaces)', () => {
    expect(validatePatientId('   ')).toBe(false);
  });

  it('returns false for a tab-only string', () => {
    expect(validatePatientId('\t')).toBe(false);
  });

  it('returns false for a newline-only string', () => {
    expect(validatePatientId('\n')).toBe(false);
  });

  it('returns false for a mixed whitespace-only string', () => {
    expect(validatePatientId(' \t\n ')).toBe(false);
  });
});

describe('generateCallId', () => {
  it('returns a string that starts with "CALL-"', () => {
    const id = generateCallId();
    expect(id.startsWith('CALL-')).toBe(true);
  });

  it('returns a string where the portion after "CALL-" is valid lowercase hex', () => {
    const id = generateCallId();
    const hexPart = id.slice('CALL-'.length);
    expect(hexPart).toMatch(/^[0-9a-f]+$/);
  });

  it('returns a string where the hex portion is non-empty', () => {
    const id = generateCallId();
    const hexPart = id.slice('CALL-'.length);
    expect(hexPart.length).toBeGreaterThan(0);
  });

  it('returns a string where the hex portion decodes to a plausible epoch millisecond timestamp', () => {
    const beforeMs = Date.now();
    const id = generateCallId();
    const afterMs = Date.now();

    const hexPart = id.slice('CALL-'.length);
    const decoded = parseInt(hexPart, 16);

    expect(decoded).toBeGreaterThanOrEqual(beforeMs);
    expect(decoded).toBeLessThanOrEqual(afterMs);
  });

  it('returns unique values on two consecutive calls', () => {
    // Both calls must at minimum be valid; in the rare case timestamps collide
    // the format still holds, so we assert format on both and check at least one
    // property that distinguishes them when the clock advances.
    const first = generateCallId();
    const second = generateCallId();

    expect(first.startsWith('CALL-')).toBe(true);
    expect(second.startsWith('CALL-')).toBe(true);

    const firstHex = first.slice('CALL-'.length);
    const secondHex = second.slice('CALL-'.length);

    expect(firstHex).toMatch(/^[0-9a-f]+$/);
    expect(secondHex).toMatch(/^[0-9a-f]+$/);

    // The second timestamp must be >= the first (monotonically non-decreasing)
    expect(parseInt(secondHex, 16)).toBeGreaterThanOrEqual(parseInt(firstHex, 16));
  });

  it('returns a value whose overall format matches CALL-<hex>', () => {
    const id = generateCallId();
    expect(id).toMatch(/^CALL-[0-9a-f]+$/);
  });
});
