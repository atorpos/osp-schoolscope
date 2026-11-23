export type SortOption = 'math_desc' | 'math_asc' | 'name_asc' | 'name_desc';

export interface Filters {
  year: string;
  district: string;
  borough: string;
  search: string;
  sort: SortOption;
}

export interface SchoolRecord {
  school_year: string;
  dbn: string;
  school_name: string;
  district: number;
  borough: string;
  enrollment: number | null;
  attendance_pct: number | null;
  math_pct: number | null;
  ela_pct: number | null;
}

export interface Summary {
  school_count: number;
  avg_math: number | null;
  avg_ela: number | null;
  avg_attendance: number | null;
  math_reporting: number;
  ela_reporting: number;
  attendance_reporting: number;
  enrolled_students: number;
}

export interface Trend {
  school_year: string;
  school_count: number;
  avg_math: number | null;
  avg_ela: number | null;
  avg_attendance: number | null;
}

export interface Metadata {
  years: string[];
  districts: number[];
  boroughs: string[];
  records: number;
  isDemo: boolean;
}

/** A real NYC public school, from NYC Open Data */
export interface SchoolLocation {
  id: string;
  /** Null for schools without a confident match in the DOE location file */
  dbn: string | null;
  name: string;
  level: string;
  sector: string;
  address: string | null;
  zip: string | null;
  borough: string;
  /** Geographic community school district, 1–32 */
  district: number;
  latitude: number;
  longitude: number;
  capacity: number | null;
}

export interface LocationFilters {
  district: string;
  borough: string;
  sector: string;
  level: string;
  search: string;
}

export interface SourceDataset {
  id: string;
  name: string;
  publisher: string;
  url: string;
  dataUpdatedAt: string | null;
}

export interface LocationMetadata {
  total: number;
  withDbn: number;
  districts: { district: number; borough: string; schools: number }[];
  boroughs: string[];
  sectors: { name: string; schools: number }[];
  levels: string[];
  source: { retrievedAt?: string; license?: string; datasets?: SourceDataset[]; notes?: string };
}

/** [longitude, latitude] */
export type Position = [number, number];

export interface DistrictFeature {
  type: 'Feature';
  properties: { district: number; borough: string | null; schools: number; label: Position | null };
  geometry: { type: 'MultiPolygon'; coordinates: Position[][][] };
}

export interface DistrictCollection {
  type: 'FeatureCollection';
  features: DistrictFeature[];
}

export interface MapKitToken {
  token: string;
  expiresAt: string;
}
