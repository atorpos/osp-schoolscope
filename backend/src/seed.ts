import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { SchoolRecord } from './types.js';
import { pool } from './db.js';

export async function migrateAndSeed(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schools (
        dbn VARCHAR(12) PRIMARY KEY,
        school_name TEXT NOT NULL,
        district SMALLINT NOT NULL,
        borough TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS school_performance (
        dbn VARCHAR(12) NOT NULL REFERENCES schools(dbn) ON DELETE CASCADE,
        school_year VARCHAR(7) NOT NULL,
        enrollment INTEGER CHECK (enrollment >= 0),
        attendance_pct NUMERIC(5,1) CHECK (attendance_pct BETWEEN 0 AND 100),
        math_pct NUMERIC(5,1) CHECK (math_pct BETWEEN 0 AND 100),
        ela_pct NUMERIC(5,1) CHECK (ela_pct BETWEEN 0 AND 100),
        PRIMARY KEY (dbn, school_year)
      );
      CREATE INDEX IF NOT EXISTS school_performance_year_idx ON school_performance (school_year);
      CREATE INDEX IF NOT EXISTS schools_district_idx ON schools (district);
    `);

    const filePath = fileURLToPath(new URL('../data/schools.json', import.meta.url));
    const records = JSON.parse(await readFile(filePath, 'utf8')) as SchoolRecord[];
    for (const row of records) {
      await client.query(`
        INSERT INTO schools (dbn, school_name, district, borough)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (dbn) DO NOTHING
      `, [row.dbn, row.school_name, row.district, row.borough]);
      await client.query(`
        INSERT INTO school_performance (dbn, school_year, enrollment, attendance_pct, math_pct, ela_pct)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (dbn, school_year) DO NOTHING
      `, [row.dbn, row.school_year, row.enrollment, row.attendance_pct, row.math_pct, row.ela_pct]);
    }
    await client.query('COMMIT');
    console.info(`Database ready: ${records.length} fictional yearly school records available for seeding`);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
