import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { authed, logIn, testApi } from './helpers.js';

test('SQLite API serves seeded data and persists changes across restarts', { timeout: 30000 }, async () => {
  const api = await testApi();
  try {
    const { body: { accessToken } } = await logIn(api.base);
    const request = authed(api.base, accessToken);
    const get = async (path: string) => {
      const response = await request(path);
      assert.equal(response.status, 200, `${path}: ${response.status}`);
      return response.json() as Promise<any>;
    };

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
    await api.stop();

    const db = new DatabaseSync(api.dbPath);
    db.prepare('UPDATE schools SET school_name = ? WHERE dbn = ?').run('Persisted name', '02M914');
    db.close();
    await api.start();
    // Access tokens outlive a restart when AUTH_SECRET is set; without it the web app renews them. Log in again here.
    const again = authed(api.base, (await logIn(api.base)).body.accessToken);
    assert.equal(((await (await again('/api/metadata')).json()) as any).records, 30);
    assert.equal(((await (await again('/api/schools/02M914/history')).json()) as any).history[0].school_name, 'Persisted name');
  } finally {
    await api.cleanup();
  }
});

test('Data endpoints need a login; health does not', { timeout: 30000 }, async () => {
  const api = await testApi();
  try {
    assert.equal((await fetch(`${api.base}/api/health`)).status, 200);
    for (const path of ['/api/metadata', '/api/schools', '/api/summary', '/api/trends', '/api/schools/02M914/history',
      '/api/locations', '/api/locations/metadata', '/api/locations/districts', '/api/mapkit/token', '/api/users/me', '/api/nothing-here']) {
      const response = await fetch(api.base + path);
      assert.equal(response.status, 401, path);
      assert.equal(response.headers.get('www-authenticate'), 'Bearer');
    }
    assert.equal((await authed(api.base, 'not-a-token')('/api/metadata')).status, 401);
  } finally {
    await api.cleanup();
  }
});
