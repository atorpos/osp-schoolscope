import { apiError, session } from './session';
import type {
  DistrictCollection, Filters, LocationFilters, LocationMetadata, MapKitToken, Metadata, SchoolLocation, SchoolRecord,
  Summary, Trend,
} from './types';

const BASE = '/api';

/** Every endpoint but health and login needs the access token */
async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  return session.withAccessToken(async token => {
    const response = await fetch(`${BASE}${path}`, { signal, headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    if (!response.ok) throw await apiError(response);
    return response.json() as Promise<T>;
  });
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

function locationQuery(filters: LocationFilters): string {
  const params = new URLSearchParams();
  for (const key of ['district', 'borough', 'sector', 'level'] as const) if (filters[key]) params.set(key, filters[key]);
  if (filters.search.trim()) params.set('search', filters.search.trim());
  return params.toString();
}

export const api = {
  metadata: (year: string, signal?: AbortSignal) => request<Metadata>(`/metadata?year=${encodeURIComponent(year)}`, signal),
  schools: (filters: Filters, signal?: AbortSignal) => request<{ schools: SchoolRecord[]; count: number }>(`/schools?${query(filters)}`, signal),
  summary: (filters: Filters, signal?: AbortSignal) => request<Summary>(`/summary?${query(filters)}`, signal),
  trends: (filters: Filters, signal?: AbortSignal) => request<{ years: Trend[] }>(`/trends?${query(filters, false)}`, signal),
  history: (dbn: string, signal?: AbortSignal) => request<{ history: SchoolRecord[] }>(`/schools/${encodeURIComponent(dbn)}/history`, signal),
  locations: (filters: LocationFilters, signal?: AbortSignal) =>
    request<{ schools: SchoolLocation[]; count: number; total: number }>(`/locations?${locationQuery(filters)}`, signal),
  locationMetadata: (signal?: AbortSignal) => request<LocationMetadata>('/locations/metadata', signal),
  districtBoundaries: (signal?: AbortSignal) => request<DistrictCollection>('/locations/districts', signal),
  /** Throws `ApiError` 503 when Apple Maps isn't configured on the server */
  mapKitToken: () => request<MapKitToken>('/mapkit/token'),
};
