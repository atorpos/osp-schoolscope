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
export interface Filters {
  year: string;
  district: number | null;
  borough: string | null;
  search: string;
  sort: 'math_desc' | 'math_asc' | 'name_asc' | 'name_desc';
}
