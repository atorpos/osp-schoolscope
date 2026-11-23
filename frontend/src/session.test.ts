import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const user = { id: 1, name: 'App Reviewer', email: 'reviewer@example.com' };
const tokens = (accessToken: string) => ({ accessToken, expiresIn: 3600, refreshExpiresIn: 2592000, user });
const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** A fresh session module per test, with fetch and the cookie jar stubbed */
async function setUp(cookie = 'schoolscope_signed_in=1') {
  vi.resetModules();
  const fetch = vi.fn<typeof globalThis.fetch>();
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('document', { cookie });
  vi.stubGlobal('navigator', {});
  const module = await import('./session');
  return { ...module, fetch };
}

describe('session', () => {
  beforeEach(() => { vi.useRealTimers(); });
  afterEach(() => { vi.unstubAllGlobals(); });

  it('shows the login page without trying to renew when there is no login cookie', async () => {
    const { session, fetch } = await setUp('');
    await session.restore();
    expect(session.getState().status).toBe('signedOut');
    expect(fetch).not.toHaveBeenCalled();
  });

  it('restores the login from the refresh cookie and joins concurrent renewals', async () => {
    const { session, fetch } = await setUp();
    fetch.mockResolvedValueOnce(reply(200, tokens('access-1')));
    await Promise.all([session.restore(), session.restore()]);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('/api/auth/refresh');
    expect(session.getState()).toEqual({ status: 'signedIn', user });
  });

  it('renews once and retries when the API rejects the access token', async () => {
    const { session, fetch, ApiError } = await setUp();
    fetch.mockResolvedValueOnce(reply(200, tokens('stale')));
    await session.logIn('reviewer@example.com', 'password');
    fetch.mockResolvedValueOnce(reply(200, tokens('fresh')));
    const seen: string[] = [];
    const result = await session.withAccessToken(async token => {
      seen.push(token);
      if (token === 'stale') throw new ApiError(401, 'Please log in again.');
      return 'data';
    });
    expect(result).toBe('data');
    expect(seen).toEqual(['stale', 'fresh']);
  });

  it('retries a renewal that another tab made at the same moment (409)', async () => {
    const { session, fetch } = await setUp();
    fetch.mockResolvedValueOnce(reply(409, { error: 'This login was just renewed. Try again.' }));
    fetch.mockResolvedValueOnce(reply(200, tokens('access-2')));
    await session.restore();
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(session.getState().status).toBe('signedIn');
  });

  it('signs out with a notice when the login has ended on the server', async () => {
    const { session, fetch, ApiError } = await setUp();
    fetch.mockResolvedValueOnce(reply(200, tokens('access-1')));
    await session.logIn('reviewer@example.com', 'password');
    fetch.mockResolvedValueOnce(reply(401, { error: 'Please log in again.' }));
    await expect(session.withAccessToken(async () => { throw new ApiError(401, 'expired'); })).rejects.toThrow('Please log in again.');
    expect(session.getState()).toEqual({ status: 'signedOut', user: null, notice: 'Your session ended. Please log in again.' });
    expect(document.cookie).toContain('Max-Age=0');
  });

  it('keeps the login when renewal fails because the network is down', async () => {
    const { session, fetch, ApiError } = await setUp();
    fetch.mockResolvedValueOnce(reply(200, tokens('access-1')));
    await session.logIn('reviewer@example.com', 'password');
    fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(session.withAccessToken(async () => { throw new ApiError(401, 'expired'); })).rejects.toThrow('Failed to fetch');
    expect(session.getState().status).toBe('signedIn');
  });

  it('reports the API’s wording for a wrong password', async () => {
    const { session, fetch } = await setUp('');
    fetch.mockResolvedValueOnce(reply(401, { error: 'Invalid email or password' }));
    await expect(session.logIn('reviewer@example.com', 'nope')).rejects.toMatchObject({ status: 401, message: 'Invalid email or password' });
    expect(session.getState().status).toBe('checking');
  });
});
