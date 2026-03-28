import { GET } from '../route';
import type { NextRequest } from 'next/server';

describe('GET /.well-known/smart-configuration', () => {
  it('returns 200', () => {
    const res = GET({} as NextRequest);
    expect(res.status).toBe(200);
  });

  it('response body contains issuer field', async () => {
    const res = GET({} as NextRequest);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('issuer');
    expect(typeof body['issuer']).toBe('string');
  });

  it('response body contains token_endpoint field', async () => {
    const res = GET({} as NextRequest);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('token_endpoint');
  });

  it('response body contains authorization_endpoint field', async () => {
    const res = GET({} as NextRequest);
    const body = await res.json() as Record<string, unknown>;
    expect(body).toHaveProperty('authorization_endpoint');
  });

  it('capabilities array contains launch-ehr', async () => {
    const res = GET({} as NextRequest);
    const body = await res.json() as Record<string, unknown>;
    const capabilities = body['capabilities'] as string[];
    expect(capabilities).toContain('launch-ehr');
  });

  it('capabilities array contains sso-openid-connect', async () => {
    const res = GET({} as NextRequest);
    const body = await res.json() as Record<string, unknown>;
    const capabilities = body['capabilities'] as string[];
    expect(capabilities).toContain('sso-openid-connect');
  });

  it('response includes Cache-Control header', () => {
    const res = GET({} as NextRequest);
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=3600');
  });

  it('scopes_supported contains openid', async () => {
    const res = GET({} as NextRequest);
    const body = await res.json() as Record<string, unknown>;
    const scopes = body['scopes_supported'] as string[];
    expect(scopes).toContain('openid');
  });

  it('code_challenge_methods_supported contains S256', async () => {
    const res = GET({} as NextRequest);
    const body = await res.json() as Record<string, unknown>;
    const methods = body['code_challenge_methods_supported'] as string[];
    expect(methods).toContain('S256');
  });

  it('jwks_uri contains /.well-known/jwks.json', async () => {
    const res = GET({} as NextRequest);
    const body = await res.json() as Record<string, unknown>;
    expect(body['jwks_uri']).toContain('/.well-known/jwks.json');
  });
});
