import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { SchoolRecord } from './types.js';
import { db } from './db.js';

export async function migrateAndSeed(): Promise<void> {
  const filePath = fileURLToPath(new URL('../data/schools.json', import.meta.url));
  const records = JSON.parse(await readFile(filePath, 'utf8')) as SchoolRecord[];
  db.exec('BEGIN');
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS schools (
        dbn TEXT PRIMARY KEY,
        school_name TEXT NOT NULL,
        district INTEGER NOT NULL,
        borough TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS school_performance (
        dbn TEXT NOT NULL REFERENCES schools(dbn) ON DELETE CASCADE,
        school_year TEXT NOT NULL,
        enrollment INTEGER CHECK (enrollment >= 0),
        attendance_pct REAL CHECK (attendance_pct BETWEEN 0 AND 100),
        math_pct REAL CHECK (math_pct BETWEEN 0 AND 100),
        ela_pct REAL CHECK (ela_pct BETWEEN 0 AND 100),
        PRIMARY KEY (dbn, school_year)
      );
      CREATE INDEX IF NOT EXISTS school_performance_year_idx ON school_performance (school_year);
      CREATE INDEX IF NOT EXISTS schools_district_idx ON schools (district);
    `);
    const insertSchool = db.prepare(`INSERT INTO schools (dbn, school_name, district, borough)
      VALUES (?, ?, ?, ?) ON CONFLICT (dbn) DO NOTHING`);
    const insertPerformance = db.prepare(`INSERT INTO school_performance
      (dbn, school_year, enrollment, attendance_pct, math_pct, ela_pct)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (dbn, school_year) DO NOTHING`);
    for (const row of records) {
      insertSchool.run(row.dbn, row.school_name, row.district, row.borough);
      insertPerformance.run(row.dbn, row.school_year, row.enrollment, row.attendance_pct, row.math_pct, row.ela_pct);
    }
    db.exec('COMMIT');
    console.info(`Database ready: ${records.length} fictional yearly school records available for seeding`);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
