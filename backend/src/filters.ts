import type { Filters } from './types.js';

const MAX_SEARCH_LENGTH = 120;
export const validSorts = ['math_desc', 'math_asc', 'name_asc', 'name_desc'] as const;

export function parseFilters(input: Record<string, unknown>): Filters {
  const year = String(input.year ?? '2025-26');
  if (!/^20\d{2}-\d{2}$/.test(year)) throw new Error('Invalid school year');

  const districtRaw = input.district === undefined ? '' : String(input.district);
  const district = districtRaw === '' ? null : Number(districtRaw);
  if (district !== null && (!Number.isInteger(district) || district < 1 || district > 99)) {
    throw new Error('District must be a whole number between 1 and 99');
  }

  const borough = input.borough ? String(input.borough) : null;
  if (borough && (borough.length > 60 || !/^[\p{L}\p{M} .'-]+$/u.test(borough))) throw new Error('Invalid borough');

  const search = String(input.search ?? '').trim();
  if (search.length > MAX_SEARCH_LENGTH) throw new Error('Search query is too long');

  const rawSort = String(input.sort ?? 'math_desc');
  if (!validSorts.some((candidate) => candidate === rawSort)) throw new Error('Invalid sorting option');
  return { year, district, borough, search, sort: rawSort as Filters['sort'] };
}

export function buildWhere(filters: Filters, includeYear = true): { where: string; values: (string | number)[] } {
  const clauses: string[] = [];
  const values: (string | number)[] = [];
  const add = (clause: string, value: string | number) => {
    values.push(value);
    clauses.push(clause);
  };

  if (includeYear) add('p.school_year = ?', filters.year);
  if (filters.district !== null) add('s.district = ?', filters.district);
  if (filters.borough) add('s.borough = ?', filters.borough);
  if (filters.search) {
    values.push(filters.search, filters.search);
    clauses.push('(INSTR(casefold(s.school_name), casefold(?)) > 0 OR INSTR(casefold(s.dbn), casefold(?)) > 0)');
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

export function orderBy(sort: Filters['sort']): string {
  switch (sort) {
    case 'math_asc': return 'p.math_pct ASC NULLS LAST, s.school_name ASC, s.dbn ASC';
    case 'name_asc': return 's.school_name ASC, s.dbn ASC';
    case 'name_desc': return 's.school_name DESC, s.dbn ASC';
    default: return 'p.math_pct DESC NULLS LAST, s.school_name ASC, s.dbn ASC';
  }
}
