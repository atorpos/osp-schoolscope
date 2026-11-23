/** Login settings from the environment, with the same defaults as the VgemsAI API */

function seconds(name: string, fallback: number, minimum = 1): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be a whole number of seconds, at least ${minimum}`);
  }
  return value;
}

const cookieSecure = (process.env.COOKIE_SECURE || 'auto').toLowerCase();
if (!['auto', 'true', 'false'].includes(cookieSecure)) throw new Error('COOKIE_SECURE must be auto, true or false');

export const authConfig = {
  /** The access token's lifetime: 60 minutes */
  accessTokenTtl: seconds('ACCESS_TOKEN_TTL', 60 * 60),
  /** The refresh token's lifetime: 30 days, renewed with every refresh */
  refreshTokenTtl: seconds('REFRESH_TOKEN_TTL', 30 * 24 * 60 * 60),
  /**
   * How long a just-replaced refresh token answers 409 "renewed elsewhere" instead of ending the login. Two
   * tabs can renew at the same moment with the same cookie; only a token used again after this ends the login.
   */
  refreshReuseGrace: seconds('REFRESH_REUSE_GRACE', 10, 0),
  /** `auto` marks the cookie Secure when the request came over HTTPS */
  cookieSecure: cookieSecure as 'auto' | 'true' | 'false',
};
