import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';

const records = JSON.parse(readFileSync(new URL('../backend/data/schools.json', import.meta.url), 'utf8'));
assert.equal(records.length, 30, 'Exactly 30 fictional school-year records are expected');
const years = ['2024-25', '2025-26'];
for (const year of years) {
  const rows = records.filter(row => row.school_year === year);
  assert.equal(rows.length, 15, `Expected 15 school records for ${year}`);
}
const ids = records.map(row => `${row.dbn}:${row.school_year}`);
assert.equal(new Set(ids).size, ids.length, 'School+year must be unique');
for (const row of records) {
  assert.ok(/^\d\d[A-Z]\d\d\d$/.test(row.dbn), `Unexpected DBN: ${row.dbn}`);
  for (const key of ['math_pct','ela_pct','attendance_pct']) {
    assert.ok(row[key] === null || (typeof row[key] === 'number' && row[key] >= 0 && row[key] <= 100), `Invalid ${key} for ${row.dbn}`);
  }
}
function mean(rows, field) {
  const values = rows.map(row => row[field]).filter(value => typeof value === 'number');
  return values.length ? +(values.reduce((acc, value) => acc + value, 0) / values.length).toFixed(1) : null;
}
const latest = records.filter(row => row.school_year === '2025-26');
assert.equal(mean(latest, 'math_pct'), 71.5);
assert.equal(mean(latest, 'ela_pct'), 68.4);
assert.equal(mean(latest, 'attendance_pct'), 92.3);
assert.equal(latest.reduce((acc, row) => acc + (row.enrollment ?? 0), 0), 6985);
assert.ok(latest.some(row => row.math_pct === 0));
assert.ok(latest.some(row => row.ela_pct === 0));
assert.ok(latest.some(row => row.math_pct === null));
console.log('PASS — 30 fictional records, 2 academic years, unique DBN/year keys, null/zero edge cases and baseline averages.');

// Real school locations from NYC Open Data (scripts/fetch-nyc-schools.mjs)
const locations = JSON.parse(readFileSync(new URL('../backend/data/school_locations.json', import.meta.url), 'utf8'));
const districts = JSON.parse(readFileSync(new URL('../backend/data/school_districts.geojson', import.meta.url), 'utf8'));
assert.equal(locations.schools.length, locations.count, 'count must match the schools listed');
assert.equal(new Set(locations.schools.map(school => school.id)).size, locations.count, 'school ids must be unique');
for (const school of locations.schools) {
  assert.ok(Number.isInteger(school.district) && school.district >= 1 && school.district <= 32, `District of ${school.name}`);
  assert.ok(school.latitude > 40.47 && school.latitude < 40.93 && school.longitude > -74.27 && school.longitude < -73.68, `Location of ${school.name}`);
  assert.ok(school.dbn === null || /^\d\d[MXKQR]\d{3}$/.test(school.dbn), `DBN of ${school.name}: ${school.dbn}`);
}
assert.deepEqual(districts.features.map(feature => feature.properties.district), Array.from({ length: 32 }, (_, i) => i + 1));
const retrieved = locations.source.retrievedAt?.slice(0, 10);
console.log(`PASS — ${locations.count} real school locations in 32 districts (NYC Open Data, retrieved ${retrieved}).`);
