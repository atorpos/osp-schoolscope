import pg from 'pg';
const { Pool } = pg;

if (!process.env.DATABASE_URL && !process.env.PGHOST) throw new Error('DATABASE_URL or PGHOST must be set');
export const pool = new Pool({
  ...(process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL }
    : { host: process.env.PGHOST, port: Number(process.env.PGPORT || 5432), user: process.env.PGUSER, password: process.env.PGPASSWORD, database: process.env.PGDATABASE }),
  max: 10,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

export async function closePool() {
  await pool.end();
}
