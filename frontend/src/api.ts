import type { Filters, Metadata, SchoolRecord, Summary, Trend } from './types';

const BASE = '/api';

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json' } });
  if (!response.ok) {
    let message = `Request failed (HTTP ${response.status})`;
    try { const body = await response.json() as { error?: string }; message = body.error || message; } catch { /* Not JSON */ }
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

function query(filters: Filters, withYear = true): string {
  const params = new URLSearchParams();
  if (withYear) params.set('year', filters.year);
  if (filters.district) params.set('district', filters.district);
  if (filters.borough) params.set('borough', filters.borough);
  if (filters.search.trim()) params.set('search', filters.search.trim());
  if (withYear) params.set('sort', filters.sort);
  return params.toString();
}

export const api = {
  metadata: (year: string, signal?: AbortSignal) => request<Metadata>(`/metadata?year=${encodeURIComponent(year)}`, signal),
  schools: (filters: Filters, signal?: AbortSignal) => request<{ schools: SchoolRecord[]; count: number }>(`/schools?${query(filters)}`, signal),
  summary: (filters: Filters, signal?: AbortSignal) => request<Summary>(`/summary?${query(filters)}`, signal),
  trends: (filters: Filters, signal?: AbortSignal) => request<{ years: Trend[] }>(`/trends?${query(filters, false)}`, signal),
  history: (dbn: string, signal?: AbortSignal) => request<{ history: SchoolRecord[] }>(`/schools/${encodeURIComponent(dbn)}/history`, signal),
};
