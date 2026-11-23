import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const REVIEWER = { email: 'reviewer@example.com', password: 'review-password-1', name: 'Test Reviewer' };

async function freePort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve, reject) => socket.close(error => (error ? reject(error) : resolve())));
  return address.port;
}

export interface TestApi {
  base: string;
  dbPath: string;
  logs: () => string;
  /** Starts (or restarts) the API on the same database */
  start: () => Promise<void>;
  stop: () => Promise<void>;
  /** Stops the API and deletes its database */
  cleanup: () => Promise<void>;
}

/** Runs the API in a child process with its own SQLite file and a reviewer account */
export async function testApi(env: Record<string, string> = {}): Promise<TestApi> {
  const dir = await mkdtemp(join(tmpdir(), 'schoolscope-test-'));
  const dbPath = join(dir, 'test.sqlite');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let logs = '';

  const start = async () => {
    child = spawn(process.execPath, ['--no-warnings', '--import', 'tsx', 'src/server.ts'], {
      env: { ...process.env, SQLITE_PATH: dbPath, PORT: String(port), DEMO_ACCOUNTS: JSON.stringify([REVIEWER]), ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', chunk => { logs += chunk; });
    child.stderr?.on('data', chunk => { logs += chunk; });
    for (let i = 0; i < 150; i++) {
      if (child.exitCode !== null) throw new Error(`API exited: ${logs}`);
      try { if ((await fetch(`${base}/api/health`)).ok) return; } catch { /* starting */ }
      await delay(100);
    }
    throw new Error(`API did not start: ${logs}`);
  };
  const stop = async () => {
    if (child && child.exitCode === null) {
      const stopped = once(child, 'exit');
      child.kill('SIGTERM');
      await stopped;
    }
    child = undefined;
  };
  await start();
  return {
    base, dbPath, start, stop,
    logs: () => logs,
    cleanup: async () => { await stop(); await rm(dir, { recursive: true, force: true }); },
  };
}

export interface LoginResult {
  status: number;
  body: any;
  /** The refresh cookie's value, if one was set */
  refresh: string | null;
  setCookies: string[];
}

export function refreshCookieOf(response: Response): string | null {
  const cookie = response.headers.getSetCookie().find(value => value.startsWith('schoolscope_refresh='));
  const value = cookie?.split(';')[0].slice('schoolscope_refresh='.length);
  return value || null;
}

export async function logIn(base: string, email = REVIEWER.email, password = REVIEWER.password): Promise<LoginResult> {
  const response = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  return { status: response.status, body: await response.json(), refresh: refreshCookieOf(response), setCookies: response.headers.getSetCookie() };
}

export async function refresh(base: string, token: string): Promise<Response> {
  return fetch(`${base}/api/auth/refresh`, { method: 'POST', headers: { Cookie: `schoolscope_refresh=${token}` } });
}

/** GET with an access token; asserts nothing */
export function authed(base: string, token: string) {
  return (path: string) => fetch(base + path, { headers: { Authorization: `Bearer ${token}` } });
}
