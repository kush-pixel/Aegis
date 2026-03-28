import type { NextRequest } from 'next/server';

interface SmartConfiguration {
  issuer:                                string;
  jwks_uri:                              string;
  authorization_endpoint:                string;
  token_endpoint:                        string;
  token_endpoint_auth_methods_supported: string[];
  grant_types_supported:                 string[];
  scopes_supported:                      string[];
  response_types_supported:              string[];
  capabilities:                          string[];
  code_challenge_methods_supported:      string[];
}

const AWS_REGION   = process.env['AWS_REGION']              ?? 'us-east-1';
const USER_POOL_ID = process.env['COGNITO_USER_POOL_ID']    ?? '';
const COGNITO_BASE = `https://cognito-idp.${AWS_REGION}.amazonaws.com/${USER_POOL_ID}`;

export function GET(_request: NextRequest): Response {
  const config: SmartConfiguration = {
    issuer:                                COGNITO_BASE,
    jwks_uri:                              `${COGNITO_BASE}/.well-known/jwks.json`,
    authorization_endpoint:                `${COGNITO_BASE}/oauth2/authorize`,
    token_endpoint:                        `${COGNITO_BASE}/oauth2/token`,
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post'],
    grant_types_supported:                 ['authorization_code', 'refresh_token'],
    scopes_supported:                      ['openid', 'profile', 'launch/patient'],
    response_types_supported:              ['code'],
    capabilities:                          ['launch-ehr', 'client-public', 'sso-openid-connect'],
    code_challenge_methods_supported:      ['S256'],
  };

  return Response.json(config, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  });
}
