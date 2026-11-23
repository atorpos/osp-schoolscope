import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { authed, logIn, refresh, refreshCookieOf, REVIEWER, testApi } from './helpers.js';
import { generatePassword, hashPassword, passwordProblem, verifyPassword } from '../src/auth/passwords.js';
import { FailureLimiter } from '../src/auth/rate-limit.js';

test('passwords are salted scrypt hashes', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.match(hash, /^scrypt\$16384\$8\$1\$/);
  assert.notEqual(hash, await hashPassword('correct horse battery'));
  assert.equal(await verifyPassword('correct horse battery', hash), true);
  assert.equal(await verifyPassword('correct horse batteries', hash), false);
  assert.equal(await verifyPassword('anything', 'not-a-hash'), false);
  assert.match(generatePassword(), /^[a-z2-9]{4}(-[a-z2-9]{4}){3}$/);
  assert.equal(passwordProblem('short'), 'Passwords need at least 8 characters');
  assert.equal(passwordProblem('long enough'), null);
});

test('failure limiter blocks after the limit until the window ends', () => {
  const limiter = new FailureLimiter(2, 1000);
  limiter.fail('a', 0);
  assert.equal(limiter.retryAfter('a', 10), 0);
  limiter.fail('a', 20);
  assert.equal(limiter.retryAfter('a', 30), 1);
  assert.equal(limiter.retryAfter('b', 30), 0);
  assert.equal(limiter.retryAfter('a', 1001), 0);
  limiter.clear('a');
  assert.equal(limiter.retryAfter('a', 40), 0);
});

test('login, renewal with a rotating refresh token, reuse detection and logout', { timeout: 60000 }, async () => {
  const api = await testApi({ REFRESH_REUSE_GRACE: '0' });
  try {
    // Wrong password and unknown email answer the same
    const wrong = await logIn(api.base, REVIEWER.email, 'not-the-password');
    assert.equal(wrong.status, 401);
    assert.deepEqual(wrong.body, { error: 'Invalid email or password' });
    assert.deepEqual((await logIn(api.base, 'nobody@example.com', 'whatever-123')).body, wrong.body);
    assert.equal((await logIn(api.base, '', '')).status, 400);

    // Emails are case-insensitive; the response mirrors VgemsAI's, with the refresh token only in a cookie
    const login = await logIn(api.base, REVIEWER.email.toUpperCase());
    assert.equal(login.status, 200);
    assert.equal(login.body.expiresIn, 3600);
    assert.equal(login.body.refreshExpiresIn, 30 * 24 * 3600);
    assert.deepEqual(login.body.user, { id: 1, name: REVIEWER.name, email: REVIEWER.email });
    assert.equal(login.body.refreshToken, undefined);
    assert.ok(login.refresh);
    const cookie = login.setCookies.find(value => value.startsWith('schoolscope_refresh='))!;
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.match(cookie, /Path=\/api\/auth/);
    assert.ok(login.setCookies.some(value => value.startsWith('schoolscope_signed_in=1') && !/HttpOnly/.test(value)));

    const me = await authed(api.base, login.body.accessToken)('/api/users/me');
    assert.deepEqual(await me.json(), { user: login.body.user });

    // Each refresh token works once and is replaced
    const first = await refresh(api.base, login.refresh!);
    assert.equal(first.status, 200);
    const renewed = await first.json() as any;
    const second = refreshCookieOf(first)!;
    assert.notEqual(second, login.refresh);
    assert.equal((await authed(api.base, renewed.accessToken)('/api/users/me')).status, 200);

    // Using the replaced token again (grace 0 here) ends the whole login
    const reused = await refresh(api.base, login.refresh!);
    assert.equal(reused.status, 401);
    assert.match(api.logs(), /replaced refresh token was used again/);
    assert.equal((await refresh(api.base, second)).status, 401);
    assert.equal((await authed(api.base, renewed.accessToken)('/api/users/me')).status, 401);

    // Logout ends the login: the refresh cookie and the access token stop working
    const other = await logIn(api.base);
    const logout = await fetch(`${api.base}/api/auth/logout`, { method: 'POST', headers: { Cookie: `schoolscope_refresh=${other.refresh}` } });
    assert.equal(logout.status, 204);
    assert.ok(logout.headers.getSetCookie().some(value => value.startsWith('schoolscope_refresh=;')));
    assert.equal((await refresh(api.base, other.refresh!)).status, 401);
    assert.equal((await authed(api.base, other.body.accessToken)('/api/metadata')).status, 401);

    assert.equal((await fetch(`${api.base}/api/auth/refresh`, { method: 'POST' })).status, 401);
  } finally {
    await api.cleanup();
  }
});

test('a tab renewing with a just-replaced token is asked to retry, not logged out', { timeout: 30000 }, async () => {
  const api = await testApi();
  try {
    const login = await logIn(api.base);
    const first = await refresh(api.base, login.refresh!);
    assert.equal(first.status, 200);
    const sameMoment = await refresh(api.base, login.refresh!);
    assert.equal(sameMoment.status, 409);
    assert.equal(sameMoment.headers.getSetCookie().length, 0);
    // The login is still fine with the new cookie
    assert.equal((await refresh(api.base, refreshCookieOf(first)!)).status, 200);
  } finally {
    await api.cleanup();
  }
});

test('too many wrong passwords are refused for a while', { timeout: 30000 }, async () => {
  const api = await testApi();
  try {
    for (let i = 0; i < 8; i++) assert.equal((await logIn(api.base, REVIEWER.email, `wrong-${i}-password`)).status, 401);
    const blocked = await fetch(`${api.base}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: REVIEWER.email, password: REVIEWER.password }),
    });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('retry-after')) > 0);
  } finally {
    await api.cleanup();
  }
});

test('DEMO_ACCOUNTS changes apply on restart and the CLI manages accounts', { timeout: 60000 }, async () => {
  const api = await testApi();
  try {
    const login = await logIn(api.base);
    await api.stop();

    // A new password in DEMO_ACCOUNTS ends the account's logins
    const changed = { ...REVIEWER, password: 'a-brand-new-password' };
    const restarted = await testApi({ SQLITE_PATH: api.dbPath, DEMO_ACCOUNTS: JSON.stringify([changed]) });
    try {
      assert.match(restarted.logs(), /reviewer@example\.com \(updated\)/);
      assert.equal((await logIn(restarted.base, REVIEWER.email, REVIEWER.password)).status, 401);
      assert.equal((await logIn(restarted.base, REVIEWER.email, changed.password)).status, 200);
      assert.equal((await refresh(restarted.base, login.refresh!)).status, 401);
    } finally {
      await restarted.stop();
    }

    const cli = (...args: string[]) => promisify(execFile)(process.execPath, ['--no-warnings', '--import', 'tsx', 'src/accounts-cli.ts', ...args], {
      env: { ...process.env, SQLITE_PATH: api.dbPath },
    });
    const added = await cli('add', 'Second@Example.com', 'Apple', 'Review');
    const password = /Password: (\S+)/.exec(added.stdout)?.[1];
    assert.ok(password);
    assert.match((await cli('list')).stdout, /second@example\.com\s+Apple Review/);
    await assert.rejects(cli('add', 'second@example.com'), /already has an account/);

    const again = await testApi({ SQLITE_PATH: api.dbPath, DEMO_ACCOUNTS: '' });
    try {
      assert.equal((await logIn(again.base, 'second@example.com', password)).status, 200);
      await cli('remove', 'second@example.com');
      assert.equal((await logIn(again.base, 'second@example.com', password)).status, 401);
    } finally {
      await again.stop();
    }
  } finally {
    await api.cleanup();
  }
});
