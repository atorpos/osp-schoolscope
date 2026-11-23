import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, SignJWT } from 'jose';
import { authConfig } from './config.js';

const ISSUER = 'schoolscope';
const AUDIENCE = 'schoolscope-web';

function loadSecret(): Uint8Array {
  const configured = process.env.AUTH_SECRET;
  if (!configured) {
    // Fine for one API process: after a restart, access tokens are rejected and the web app renews them with
    // its refresh cookie, which lives in the database
    return randomBytes(32);
  }
  if (configured.length < 32) throw new Error('AUTH_SECRET must be at least 32 characters');
  return new TextEncoder().encode(configured);
}
const secret = loadSecret();

export interface AccessClaims {
  userId: number;
  sessionId: string;
}

/** A short-lived HS256 JWT naming the user and the login (session) it belongs to */
export async function signAccessToken({ userId, sessionId }: AccessClaims): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ sid: sessionId })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(String(userId))
    .setIssuedAt(now)
    .setExpirationTime(now + authConfig.accessTokenTtl)
    .sign(secret);
}

/** The claims of a valid, unexpired access token, or null */
export async function verifyAccessToken(token: string): Promise<AccessClaims | null> {
  try {
    const { payload } = await jwtVerify(token, secret, { algorithms: ['HS256'], issuer: ISSUER, audience: AUDIENCE });
    const userId = Number(payload.sub);
    if (!Number.isInteger(userId) || typeof payload.sid !== 'string') return null;
    return { userId, sessionId: payload.sid };
  } catch {
    return null;
  }
}

export const newRefreshToken = (): string => randomBytes(32).toString('base64url');
export const newSessionId = (): string => randomBytes(16).toString('base64url');
/** Refresh tokens are stored only as hashes */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
