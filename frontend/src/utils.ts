import type { SchoolRecord } from './types';

export function formatPercent(value: number | null | undefined): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(1)}%` : 'N/A';
}

export function mean(values: Array<number | null | undefined>): number | null {
  const valid = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  return valid.length ? valid.reduce((sum, value) => sum + value, 0) / valid.length : null;
}

/** "App Reviewer" -> "AR", for the avatar */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0], words.at(-1)!] : words;
  return letters.map(word => [...word][0] ?? '').join('').toUpperCase() || '?';
}

export function scoreTone(value: number | null): 'strong' | 'moderate' | 'attention' | 'missing' {
  if (value === null) return 'missing';
  if (value >= 80) return 'strong';
  if (value >= 60) return 'moderate';
  return 'attention';
}

function csvEscape(value: string | number | null): string {
  if (value === null) return '';
  const text = String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildCSV(rows: SchoolRecord[]): string {
  const columns = ['school_year', 'dbn', 'school_name', 'district', 'borough', 'enrollment', 'attendance_pct', 'math_pct', 'ela_pct'] as const;
  return [columns.join(','), ...rows.map(row => columns.map(column => csvEscape(row[column])).join(','))].join('\r\n');
}

export function downloadCSV(rows: SchoolRecord[], year: string) {
  const file = new Blob(['\ufeff', buildCSV(rows)], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(file);
  const link = document.createElement('a');
  link.href = url;
  link.download = `schoolscope-${year}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
