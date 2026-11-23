import { describe, expect, it } from 'vitest';
import { buildCSV, formatPercent, mean } from './utils';
import type { SchoolRecord } from './types';

describe('dashboard helpers', () => {
  it('counts 0 as a valid score and excludes missing values', () => {
    expect(mean([0, 80, null])).toBe(40);
    expect(mean([null, undefined])).toBeNull();
  });
  it('formats missing values honestly', () => {
    expect(formatPercent(null)).toBe('N/A');
    expect(formatPercent(0)).toBe('0.0%');
  });
  it('escapes CSV punctuation', () => {
    const row: SchoolRecord = { school_year: '2025-26', dbn: '02M001', school_name: 'School, "Alpha"', district: 2, borough: 'Manhattan', enrollment: 12, attendance_pct: null, math_pct: 0, ela_pct: 81 };
    const csv = buildCSV([row]);
    expect(csv).toContain('"School, ""Alpha"""');
    expect(csv).toContain('"0"');
  });
});
