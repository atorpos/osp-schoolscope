import express, { type Request, type RequestHandler, type Response } from 'express';
import { db } from '../db.js';
import { asyncRoute } from '../http.js';
import { normalizeEmail } from './accounts.js';
import { authConfig } from './config.js';
import { dummyPasswordHash, MAX_PASSWORD_LENGTH, verifyPassword } from './passwords.js';
import { FailureLimiter } from './rate-limit.js';
import { hashToken, newRefreshToken, newSessionId, signAccessToken, verifyAccessToken } from './tokens.js';

export interface AuthUser {
  id: number;
  name: string;
  email: string;
}

/**
 * The refresh token lives in an httpOnly cookie that only the /api/auth routes receive, so page scripts can't
 * read it. The access token is kept in memory by the web app and sent as `Authorization: Bearer …`.
 */
const REFRESH_COOKIE = 'schoolscope_refresh';
const COOKIE_PATH = '/api/auth';
/** Readable by the page and holds no secret: tells it whether a refresh is worth trying on load */
const SIGNED_IN_COOKIE = 'schoolscope_signed_in';

/** Wrong passwords: 8 per address and email, and 40 per address, in 15 minutes */
const FAILURE_WINDOW = 15 * 60 * 1000;
const accountFailures = new FailureLimiter(8, FAILURE_WINDOW);
const addressFailures = new FailureLimiter(40, FAILURE_WINDOW);

const loggedOut = { error: 'Please log in again.' };

function readCookie(req: Request, name: string): string | null {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const separator = part.indexOf('=');
    if (separator > 0 && part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim() || null;
  }
  return null;
}

function cookieOptions(req: Request) {
  const secure = authConfig.cookieSecure === 'auto' ? req.secure : authConfig.cookieSecure === 'true';
  return { httpOnly: true, sameSite: 'strict' as const, secure, path: COOKIE_PATH };
}

function clearRefreshCookie(req: Request, res: Response): void {
  res.clearCookie(REFRESH_COOKIE, cookieOptions(req));
  res.clearCookie(SIGNED_IN_COOKIE, { ...cookieOptions(req), httpOnly: false, path: '/' });
}

/** Sets the refresh cookie and answers like VgemsAI's API, minus the refresh token itself */
async function sendTokens(req: Request, res: Response, user: AuthUser, sessionId: string, refreshToken: string) {
  const maxAge = authConfig.refreshTokenTtl * 1000;
  res.cookie(REFRESH_COOKIE, refreshToken, { ...cookieOptions(req), maxAge });
  res.cookie(SIGNED_IN_COOKIE, '1', { ...cookieOptions(req), httpOnly: false, path: '/', maxAge });
  res.set('Cache-Control', 'no-store');
  res.json({
    accessToken: await signAccessToken({ userId: user.id, sessionId }),
    expiresIn: authConfig.accessTokenTtl,
    refreshExpiresIn: authConfig.refreshTokenTtl,
    user,
  });
}

const userAgent = (req: Request) => req.get('user-agent')?.slice(0, 300) ?? null;

export const authRouter = express.Router();

/** `POST /api/auth/login {email, password}`: tokens, or 401 for a wrong email or password */
authRouter.post('/login', asyncRoute(async (req, res) => {
  const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!email || !password || email.length > 254 || password.length > MAX_PASSWORD_LENGTH) {
    return void res.status(400).json({ error: 'Enter your email and password.' });
  }

  const addressKey = req.ip ?? 'unknown';
  const accountKey = `${addressKey}|${email}`;
  const wait = Math.max(addressFailures.retryAfter(addressKey), accountFailures.retryAfter(accountKey));
  if (wait > 0) {
    res.set('Retry-After', String(wait));
    return void res.status(429).json({ error: `Too many attempts. Try again in ${Math.ceil(wait / 60)} minutes.` });
  }

  const user = db.prepare('SELECT id, name, email, password_hash, disabled FROM users WHERE email = ?').get(email) as
    | (AuthUser & { password_hash: string; disabled: number })
    | undefined;
  // Always check a hash, so a missing account answers as slowly as a wrong password
  const valid = await verifyPassword(password, user?.password_hash ?? await dummyPasswordHash());
  if (!user || !valid || user.disabled) {
    addressFailures.fail(addressKey);
    accountFailures.fail(accountKey);
    return void res.status(401).json({ error: 'Invalid email or password' });
  }
  accountFailures.clear(accountKey);

  const now = Date.now();
  const sessionId = newSessionId();
  const refreshToken = newRefreshToken();
  db.prepare(`INSERT INTO auth_sessions (id, user_id, refresh_hash, expires_at, created_at, last_used_at, user_agent, ip)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
    .run(sessionId, user.id, hashToken(refreshToken), now + authConfig.refreshTokenTtl * 1000, now, now, userAgent(req), req.ip ?? null);
  db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?').run(new Date(now).toISOString(), user.id);
  await sendTokens(req, res, { id: user.id, name: user.name, email: user.email }, sessionId, refreshToken);
}));

/**
 * `POST /api/auth/refresh`, with the refresh cookie: new tokens, and a new refresh cookie. A refresh token
 * works once. Using a replaced one again ends the login (it may have been copied), except right after it
 * was replaced: then it's another tab renewing at the same moment, which gets 409 and retries.
 */
authRouter.post('/refresh', asyncRoute(async (req, res) => {
  const token = readCookie(req, REFRESH_COOKIE);
  if (!token) return void res.status(401).json(loggedOut);
  const hash = hashToken(token);
  const now = Date.now();

  const session = db.prepare(`SELECT s.id, s.expires_at, s.revoked_at, u.id AS user_id, u.name, u.email, u.disabled
    FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.refresh_hash = ?`).get(hash) as
    | { id: string; expires_at: number; revoked_at: number | null; user_id: number; name: string; email: string; disabled: number }
    | undefined;
  if (session) {
    if (session.revoked_at !== null || session.expires_at <= now || session.disabled) {
      clearRefreshCookie(req, res);
      return void res.status(401).json(loggedOut);
    }
    const next = newRefreshToken();
    db.prepare(`UPDATE auth_sessions SET refresh_hash = ?, previous_refresh_hash = ?, rotated_at = ?, expires_at = ?,
      last_used_at = ?, user_agent = ?, ip = ? WHERE id = ?`)
      .run(hashToken(next), hash, now, now + authConfig.refreshTokenTtl * 1000, now, userAgent(req), req.ip ?? null, session.id);
    return void await sendTokens(req, res, { id: session.user_id, name: session.name, email: session.email }, session.id, next);
  }

  const replaced = db.prepare('SELECT id, rotated_at FROM auth_sessions WHERE previous_refresh_hash = ? AND revoked_at IS NULL')
    .get(hash) as { id: string; rotated_at: number } | undefined;
  if (replaced && now - replaced.rotated_at <= authConfig.refreshReuseGrace * 1000) {
    // The browser already has the new cookie from the other request
    return void res.status(409).json({ error: 'This login was just renewed. Try again.' });
  }
  if (replaced) {
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ?').run(now, replaced.id);
    console.warn(`A replaced refresh token was used again; ended login ${replaced.id}`);
  }
  clearRefreshCookie(req, res);
  res.status(401).json(loggedOut);
}));

/** `POST /api/auth/logout`: ends the login on the server too */
authRouter.post('/logout', asyncRoute(async (req, res) => {
  const now = Date.now();
  const token = readCookie(req, REFRESH_COOKIE);
  if (token) {
    const hash = hashToken(token);
    db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE (refresh_hash = ? OR previous_refresh_hash = ?) AND revoked_at IS NULL')
      .run(now, hash, hash);
  } else {
    const bearer = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1];
    const claims = bearer ? await verifyAccessToken(bearer) : null;
    if (claims) db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL').run(now, claims.sessionId);
  }
  clearRefreshCookie(req, res);
  res.status(204).end();
}));

/**
 * Lets a request through with a valid access token whose login hasn't ended, and puts the user in
 * `res.locals.user`. Otherwise answers 401, after which the web app renews its tokens once and retries.
 */
export const requireAuth: RequestHandler = asyncRoute(async (req, res, next) => {
  const bearer = /^Bearer (.+)$/i.exec(req.get('authorization') ?? '')?.[1];
  const claims = bearer ? await verifyAccessToken(bearer) : null;
  const user = claims && db.prepare(`SELECT u.id, u.name, u.email FROM auth_sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.disabled = 0`)
    .get(claims.sessionId, claims.userId, Date.now()) as AuthUser | undefined;
  if (!user) {
    res.set('WWW-Authenticate', 'Bearer');
    return void res.status(401).json(loggedOut);
  }
  res.locals.user = { id: user.id, name: user.name, email: user.email } satisfies AuthUser;
  next();
});
