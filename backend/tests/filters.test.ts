import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWhere, orderBy, parseFilters } from '../src/filters.js';

test('parses filters and defaults', () => {
  assert.deepEqual(parseFilters({}), { year: '2025-26', district: null, borough: null, search: '', sort: 'math_desc' });
});
test('parses district as number and strips whitespace from search', () => {
  assert.deepEqual(parseFilters({ year: '2024-25', district: '2', search: ' Élan  ', sort: 'math_asc' }).district, 2);
  assert.equal(parseFilters({ search: ' Élan  ' }).search, 'Élan');
});
test('rejects unsafe invalid filter input', () => {
  assert.throws(() => parseFilters({ district: '2 OR 1=1' }), /District/);
  assert.throws(() => parseFilters({ sort: 'DROP TABLE schools' }), /Invalid sorting/);
  assert.throws(() => parseFilters({ search: 'a'.repeat(121) }), /too long/);
});
test('uses parameterized SQL and safe fixed sort expressions', () => {
  const input = parseFilters({ district: '2', borough: 'Manhattan', search: '%_test' });
  const result = buildWhere(input);
  assert.ok(result.where.includes('ILIKE $4'));
  assert.equal(result.values.length, 4);
  assert.ok(result.values[3] !== '%_test');
  assert.ok(orderBy('math_asc').includes('NULLS LAST'));
});
