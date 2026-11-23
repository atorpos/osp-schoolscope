import { readFileSync } from 'node:fs';
import express from 'express';
import type { SQLInputValue } from 'node:sqlite';
import { db } from './db.js';

/** A real NYC public school, from the snapshot `scripts/fetch-nyc-schools.mjs` makes of NYC Open Data */
export interface SchoolLocation {
  id: string;
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

interface Snapshot {
  source: Record<string, unknown>;
  count: number;
  schools: SchoolLocation[];
}

const dataFile = (name: string) => new URL(`../data/${name}`, import.meta.url);

let source: Snapshot['source'] = {};
let districtBoundaries = '';

/**
 * Replaces the school locations with the snapshot in `data/school_locations.json`. It's reference data, so the
 * table always matches the file the API was built with.
 */
export function seedLocations(): void {
  const snapshot = JSON.parse(readFileSync(dataFile('school_locations.json'), 'utf8')) as Snapshot;
  districtBoundaries = readFileSync(dataFile('school_districts.geojson'), 'utf8');
  source = snapshot.source;
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS school_locations (
        id TEXT PRIMARY KEY,
        dbn TEXT,
        name TEXT NOT NULL,
        level TEXT NOT NULL,
        sector TEXT NOT NULL,
        address TEXT,
        zip TEXT,
        borough TEXT NOT NULL,
        district INTEGER NOT NULL CHECK (district BETWEEN 1 AND 32),
        latitude REAL NOT NULL CHECK (latitude BETWEEN 40.4 AND 41.0),
        longitude REAL NOT NULL CHECK (longitude BETWEEN -74.3 AND -73.6),
        capacity INTEGER CHECK (capacity > 0)
      );
      CREATE INDEX IF NOT EXISTS school_locations_district_idx ON school_locations (district);
      DELETE FROM school_locations;
    `);
    const insert = db.prepare(`INSERT INTO school_locations
      (id, dbn, name, level, sector, address, zip, borough, district, latitude, longitude, capacity)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const s of snapshot.schools) {
      insert.run(s.id, s.dbn, s.name, s.level, s.sector, s.address, s.zip, s.borough, s.district, s.latitude, s.longitude, s.capacity);
    }
    db.exec('COMMIT');
    console.info(`School locations ready: ${snapshot.schools.length} real NYC schools`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export interface LocationFilters {
  district: number | null;
  borough: string | null;
  sector: string | null;
  level: string | null;
  search: string;
}

const distinct = (column: 'borough' | 'sector' | 'level') =>
  (db.prepare(`SELECT DISTINCT ${column} AS value FROM school_locations ORDER BY value`).all() as { value: string }[]).map(r => r.value);

/** Validates the query string; values must be ones the data has. Throws "Invalid …" (answered with 400). */
export function parseLocationFilters(input: Record<string, unknown>): LocationFilters {
  const text = (key: string) => (typeof input[key] === 'string' && input[key] !== '' ? String(input[key]) : null);
  const districtRaw = text('district');
  const district = districtRaw === null ? null : Number(districtRaw);
  if (district !== null && (!Number.isInteger(district) || district < 1 || district > 32)) {
    throw new Error('Invalid district: use a community school district from 1 to 32');
  }
  const oneOf = (key: 'borough' | 'sector' | 'level') => {
    const value = text(key);
    if (value !== null && !distinct(key).includes(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const search = String(input.search ?? '').trim();
  if (search.length > 120) throw new Error('Search query is too long');
  return { district, borough: oneOf('borough'), sector: oneOf('sector'), level: oneOf('level'), search };
}

export function locationWhere(filters: LocationFilters): { where: string; values: SQLInputValue[] } {
  const clauses: string[] = [];
  const values: SQLInputValue[] = [];
  if (filters.district !== null) { clauses.push('district = ?'); values.push(filters.district); }
  if (filters.borough) { clauses.push('borough = ?'); values.push(filters.borough); }
  if (filters.sector) { clauses.push('sector = ?'); values.push(filters.sector); }
  if (filters.level) { clauses.push('level = ?'); values.push(filters.level); }
  if (filters.search) {
    clauses.push(`(INSTR(casefold(name), casefold(?)) > 0 OR INSTR(casefold(COALESCE(dbn, '')), casefold(?)) > 0
      OR INSTR(casefold(COALESCE(address, '')), casefold(?)) > 0)`);
    values.push(filters.search, filters.search, filters.search);
  }
  return { where: clauses.length ? `WHERE ${clauses.join(' AND ')}` : '', values };
}

export const locationsRouter = express.Router();

/** `GET /api/locations?district=&borough=&sector=&level=&search=`: matching schools, for the map */
locationsRouter.get('/', (req, res) => {
  const { where, values } = locationWhere(parseLocationFilters(req.query));
  const schools = db.prepare(`SELECT id, dbn, name, level, sector, address, zip, borough, district, latitude, longitude, capacity
    FROM school_locations ${where} ORDER BY district, name, id`).all(...values) as unknown as SchoolLocation[];
  const { total } = db.prepare('SELECT COUNT(*) AS total FROM school_locations').get() as { total: number };
  res.json({ schools, count: schools.length, total });
});

/** `GET /api/locations/metadata`: filter options, counts and where the data came from */
locationsRouter.get('/metadata', (_req, res) => {
  const totals = db.prepare('SELECT COUNT(*) AS total, COUNT(dbn) AS with_dbn FROM school_locations').get() as { total: number; with_dbn: number };
  const districts = db.prepare(`SELECT district, borough, COUNT(*) AS schools FROM school_locations
    GROUP BY district, borough ORDER BY district, schools DESC`).all() as { district: number; borough: string; schools: number }[];
  // A few schools sit in a district mostly in another borough: name each district after its main borough
  const byDistrict = new Map<number, { district: number; borough: string; schools: number }>();
  for (const row of districts) {
    const known = byDistrict.get(row.district);
    if (known) known.schools += row.schools;
    else byDistrict.set(row.district, { ...row });
  }
  const sectors = db.prepare('SELECT sector AS name, COUNT(*) AS schools FROM school_locations GROUP BY sector ORDER BY schools DESC').all();
  res.json({
    total: totals.total,
    withDbn: totals.with_dbn,
    districts: [...byDistrict.values()],
    boroughs: distinct('borough'),
    sectors,
    levels: distinct('level'),
    source,
  });
});

/** `GET /api/locations/districts`: community school district boundaries as GeoJSON */
locationsRouter.get('/districts', (_req, res) => {
  res.set('Cache-Control', 'private, max-age=3600');
  res.type('application/geo+json').send(districtBoundaries);
});
