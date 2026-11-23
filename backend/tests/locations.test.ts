import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { authed, logIn, testApi } from './helpers.js';

const snapshot = JSON.parse(await readFile(new URL('../data/school_locations.json', import.meta.url), 'utf8'));

test('the school location snapshot is complete and inside New York City', () => {
  assert.equal(snapshot.count, snapshot.schools.length);
  assert.ok(snapshot.schools.length > 1500, 'expected every NYC public school');
  const ids = new Set();
  for (const school of snapshot.schools) {
    assert.ok(!ids.has(school.id), `duplicate id ${school.id}`);
    ids.add(school.id);
    assert.ok(school.district >= 1 && school.district <= 32, `${school.name}: district ${school.district}`);
    assert.ok(school.latitude > 40.47 && school.latitude < 40.93, `${school.name}: latitude`);
    assert.ok(school.longitude > -74.27 && school.longitude < -73.68, `${school.name}: longitude`);
    assert.ok(school.dbn === null || /^\d\d[MXKQR]\d{3}$/.test(school.dbn), `${school.name}: DBN ${school.dbn}`);
    assert.ok(['Manhattan', 'Bronx', 'Brooklyn', 'Queens', 'Staten Island'].includes(school.borough));
  }
  assert.ok(snapshot.source.datasets.some((dataset: { id: string }) => dataset.id === 'ji82-xba5'));
});

test('locations API filters real schools and serves district boundaries', { timeout: 30000 }, async () => {
  const api = await testApi();
  try {
    const get = authed(api.base, (await logIn(api.base)).body.accessToken);
    const json = async (path: string, status = 200) => {
      const response = await get(path);
      assert.equal(response.status, status, path);
      return response.json() as Promise<any>;
    };

    const all = await json('/api/locations');
    assert.equal(all.count, snapshot.schools.length);
    assert.equal(all.total, snapshot.schools.length);

    const district2 = await json('/api/locations?district=2');
    assert.ok(district2.count > 50);
    assert.ok(district2.schools.every((school: { district: number }) => school.district === 2));

    const stuyvesant = await json('/api/locations?search=02m475');
    assert.equal(stuyvesant.count, 1);
    assert.equal(stuyvesant.schools[0].name, 'Stuyvesant High School');
    assert.equal((await json('/api/locations?search=chambers%20street')).schools.some((s: { dbn: string }) => s.dbn === '02M475'), true);

    const charters = await json('/api/locations?sector=Charter&borough=Bronx');
    assert.ok(charters.count > 0);
    assert.ok(charters.schools.every((s: { sector: string; borough: string }) => s.sector === 'Charter' && s.borough === 'Bronx'));

    assert.match((await json('/api/locations?district=33', 400)).error, /Invalid district/);
    assert.match((await json('/api/locations?borough=Atlantis', 400)).error, /Invalid borough/);
    assert.match((await json('/api/locations?sector=%27%20OR%201%3D1', 400)).error, /Invalid sector/);

    const metadata = await json('/api/locations/metadata');
    assert.equal(metadata.total, snapshot.schools.length);
    assert.equal(metadata.districts.length, 32);
    assert.equal(metadata.boroughs.length, 5);
    assert.ok(metadata.source.datasets.length >= 3);

    const boundaries = await get('/api/locations/districts');
    assert.match(boundaries.headers.get('content-type') ?? '', /application\/geo\+json/);
    const geo = await boundaries.json() as any;
    assert.equal(geo.type, 'FeatureCollection');
    assert.deepEqual(geo.features.map((f: any) => f.properties.district), Array.from({ length: 32 }, (_, i) => i + 1));
  } finally {
    await api.cleanup();
  }
});
