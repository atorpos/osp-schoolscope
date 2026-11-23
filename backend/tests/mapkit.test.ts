import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decodeProtectedHeader, importSPKI, jwtVerify } from 'jose';
import { MAPKIT_TOKEN_TTL, mapKitConfig, mapKitTokenSigner } from '../src/mapkit.js';
import { authed, logIn, testApi } from './helpers.js';

const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const pem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
const verificationKey = () => importSPKI(publicKey.export({ type: 'spki', format: 'pem' }).toString(), 'ES256');

test('MapKit settings: all three together, a \\n-escaped key, or none', () => {
  assert.equal(mapKitConfig({}), null);
  assert.throws(() => mapKitConfig({ MAPKIT_TEAM_ID: 'TEAM123456' }), /MAPKIT_TEAM_ID, MAPKIT_KEY_ID and MAPKIT_PRIVATE_KEY/);
  const config = mapKitConfig({ MAPKIT_TEAM_ID: ' TEAM123456 ', MAPKIT_KEY_ID: 'KEY1234567', MAPKIT_PRIVATE_KEY: pem.replace(/\n/g, '\\n') });
  assert.equal(config?.teamId, 'TEAM123456');
  assert.equal(config?.privateKey, pem.trim());
  assert.equal(config?.origin, null);
});

test('MapKit tokens are ES256 JWTs in the shape Apple documents', async () => {
  const sign = await mapKitTokenSigner({ teamId: 'TEAM123456', keyId: 'KEY1234567', privateKey: pem, origin: 'https://schools.example.com' });
  const { token, expiresAt } = await sign();
  assert.deepEqual(decodeProtectedHeader(token), { alg: 'ES256', kid: 'KEY1234567', typ: 'JWT' });
  const { payload } = await jwtVerify(token, await verificationKey(), { issuer: 'TEAM123456' });
  assert.equal(payload.origin, 'https://schools.example.com');
  assert.equal(payload.exp! - payload.iat!, MAPKIT_TOKEN_TTL);
  assert.equal(new Date(expiresAt).getTime(), payload.exp! * 1000);
  await assert.rejects(mapKitTokenSigner({ teamId: 'T', keyId: 'K', privateKey: 'not a key', origin: null }));
});

test('GET /api/mapkit/token signs with the configured key, or answers 503', { timeout: 30000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'schoolscope-mapkit-'));
  const keyFile = join(dir, 'AuthKey_KEY1234567.p8');
  await writeFile(keyFile, pem);
  const configured = await testApi({ MAPKIT_TEAM_ID: 'TEAM123456', MAPKIT_KEY_ID: 'KEY1234567', MAPKIT_PRIVATE_KEY_FILE: keyFile });
  const unconfigured = await testApi();
  const misconfigured = await testApi({ MAPKIT_TEAM_ID: 'TEAM123456', MAPKIT_KEY_ID: 'KEY1234567', MAPKIT_PRIVATE_KEY: 'garbage' });
  try {
    const response = await authed(configured.base, (await logIn(configured.base)).body.accessToken)('/api/mapkit/token');
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const { token } = await response.json() as { token: string };
    assert.equal((await jwtVerify(token, await verificationKey())).payload.iss, 'TEAM123456');

    const off = await authed(unconfigured.base, (await logIn(unconfigured.base)).body.accessToken)('/api/mapkit/token');
    assert.equal(off.status, 503);
    assert.deepEqual(await off.json(), { error: 'Apple Maps is not configured on this server.', configured: false });

    const bad = await authed(misconfigured.base, (await logIn(misconfigured.base)).body.accessToken)('/api/mapkit/token');
    assert.equal(bad.status, 503);
    assert.match(misconfigured.logs(), /Apple Maps disabled/);
  } finally {
    await Promise.all([configured.cleanup(), unconfigured.cleanup(), misconfigured.cleanup()]);
    await rm(dir, { recursive: true, force: true });
  }
});
