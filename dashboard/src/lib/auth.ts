import { CognitoJwtVerifier } from 'aws-jwt-verify';

export interface VerifiedToken {
  sub: string;
}

export type JwtVerifier = (token: string) => Promise<VerifiedToken>;

export function extractBearerToken(request: Request): string | null {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  const token = header.slice(7).trim();
  return token.length > 0 ? token : null;
}

export function createJwtVerifier(): JwtVerifier {
  const userPoolId = process.env['COGNITO_USER_POOL_ID'] ?? '';
  const clientId   = process.env['COGNITO_CLIENT_ID']    ?? '';

  const verifier = CognitoJwtVerifier.create({
    userPoolId,
    tokenUse: 'access',
    clientId,
  });

  return async (token: string): Promise<VerifiedToken> => {
    const payload = await verifier.verify(token);
    return { sub: payload.sub };
  };
}
