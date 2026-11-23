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
