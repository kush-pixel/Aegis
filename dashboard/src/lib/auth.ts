import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface VerifiedToken {
  sub: string;
}

export type JwtVerifier = (token: string) => Promise<VerifiedToken>;

const DEV_BYPASS_TOKEN = 'dev-bypass';

export function extractBearerToken(request: Request): string | null {
  if (process.env['AUTH_BYPASS'] === 'true') {
    const header = request.headers.get('Authorization');
    if (!header?.startsWith('Bearer ')) return DEV_BYPASS_TOKEN;
    const token = header.slice(7).trim();
    return token.length > 0 ? token : DEV_BYPASS_TOKEN;
  }
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

const DEV_USER: VerifiedToken = { sub: 'dev-user' };

export function createJwtVerifier(): JwtVerifier {
  if (process.env['AUTH_BYPASS'] === 'true') {
    return async (_token: string): Promise<VerifiedToken> => DEV_USER;
  }

  let verifier: ReturnType<typeof CognitoJwtVerifier.create> | null = null;

  return async (token: string): Promise<VerifiedToken> => {
    if (!verifier) {
      const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? '';
      const clientId   = process.env['COGNITO_CLIENT_ID']    ?? '';
      verifier = CognitoJwtVerifier.create({
        userPoolId,
        tokenUse: 'access',
        clientId,
      });
    }
    const payload = await verifier.verify(token);
    return { sub: payload.sub };
  };
}
