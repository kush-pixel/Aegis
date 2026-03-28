/**
 * Tests for auth.ts
 *
 * AUTH_BYPASS=true activates the dev bypass. Tests that need to verify
 * production auth behaviour (401 on missing header) simply do not set it.
 */
import { extractBearerToken, createJwtVerifier } from '../auth';

const makeRequest = (authHeader?: string): Request =>
  new Request('http://localhost/api/triage', {
    headers: authHeader ? { Authorization: authHeader } : {},
  });

// ─── auth bypass active (AUTH_BYPASS=true) ────────────────────────────────────

describe('extractBearerToken — AUTH_BYPASS=true', () => {
  beforeEach(() => { process.env['AUTH_BYPASS'] = 'true'; });
  afterEach(() => { delete process.env['AUTH_BYPASS']; });

  it('returns non-null when no Authorization header', () => {
    expect(extractBearerToken(makeRequest())).not.toBeNull();
  });

  it('returns non-null when header does not start with Bearer', () => {
    expect(extractBearerToken(makeRequest('Basic abc123'))).not.toBeNull();
  });

  it('returns non-null when token is empty string after Bearer', () => {
    expect(extractBearerToken(makeRequest('Bearer '))).not.toBeNull();
  });

  it('returns the real token when a valid Bearer header is present', () => {
    expect(extractBearerToken(makeRequest('Bearer real.token'))).toBe('real.token');
  });
});

describe('createJwtVerifier — AUTH_BYPASS=true', () => {
  beforeEach(() => { process.env['AUTH_BYPASS'] = 'true'; });
  afterEach(() => { delete process.env['AUTH_BYPASS']; });

  it('resolves with a mock user for the dev bypass token', async () => {
    const verify = createJwtVerifier();
    await expect(verify('dev-bypass')).resolves.toEqual({ sub: 'dev-user' });
  });

  it('resolves with a mock user for any arbitrary token', async () => {
    const verify = createJwtVerifier();
    await expect(verify('any.token.value')).resolves.toEqual({ sub: 'dev-user' });
  });
});

// ─── no bypass (AUTH_BYPASS not set — default for all tests) ──────────────────

describe('extractBearerToken — no bypass', () => {
  it('returns null when no Authorization header', () => {
    expect(extractBearerToken(makeRequest())).toBeNull();
  });

  it('returns null when header does not start with Bearer', () => {
    expect(extractBearerToken(makeRequest('Basic abc123'))).toBeNull();
  });

  it('returns null when token is empty string after Bearer', () => {
    expect(extractBearerToken(makeRequest('Bearer '))).toBeNull();
  });

  it('returns token when valid Bearer header is present', () => {
    expect(extractBearerToken(makeRequest('Bearer valid.token.here'))).toBe('valid.token.here');
  });
});
