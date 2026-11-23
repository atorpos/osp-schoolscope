import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';

async function freePort(): Promise<number> {
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const address = socket.address();
  if (!address || typeof address === 'string') throw new Error('No test port');
  await new Promise<void>((resolve, reject) => socket.close(error => error ? reject(error) : resolve()));
  return address.port;
}

test('SQLite API serves seeded data and persists changes across restarts', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'schoolscope-test-'));
  const path = join(dir, 'test.sqlite');
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let child: ChildProcess | undefined;
  let logs = '';
  const start = async () => {
    child = spawn(process.execPath, ['--import', 'tsx', 'src/server.ts'], {
      env: { ...process.env, SQLITE_PATH: path, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout?.on('data', chunk => { logs += chunk; });
    child.stderr?.on('data', chunk => { logs += chunk; });
    for (let i = 0; i < 100; i++) {
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
  const get = async (path: string) => {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    return response.json() as Promise<any>;
  };
  try {
    await start();
    assert.equal((await get('/api/metadata')).records, 30);
    const summary = await get('/api/summary?year=2025-26');
    assert.equal(summary.school_count, 15);
    assert.equal(typeof summary.avg_math, 'number');
    const sorted = await get('/api/schools?year=2025-26&sort=math_asc');
    assert.equal(sorted.schools.length, 15);
    assert.equal(sorted.schools.at(-1).math_pct, null);
    const search = await get('/api/schools?year=2025-26&search=%C3%A9LAN');
    assert.equal(search.schools[0].dbn, '02M914');
    assert.equal((await get('/api/schools?year=2025-26&search=%25')).count, 0);
    assert.equal((await get('/api/schools/02M914/history')).history.length, 2);
    assert.equal((await get('/api/trends?district=2')).years.length, 2);
    await stop();

    const db = new DatabaseSync(path);
    db.prepare('UPDATE schools SET school_name = ? WHERE dbn = ?').run('Persisted name', '02M914');
    db.close();
    await start();
    assert.equal((await get('/api/metadata')).records, 30);
    assert.equal((await get('/api/schools/02M914/history')).history[0].school_name, 'Persisted name');
  } finally {
    await stop();
    await rm(dir, { recursive: true, force: true });
  }
});
