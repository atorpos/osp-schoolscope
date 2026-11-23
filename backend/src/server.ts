import express, { type ErrorRequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import { pool, closePool } from './db.js';
import { migrateAndSeed } from './seed.js';
import { parseFilters, buildWhere, orderBy } from './filters.js';
import type { SchoolRecord } from './types.js';

const app = express();
app.disable('x-powered-by');
app.use(helmet());
app.use(cors({ origin: process.env.NODE_ENV === 'production' ? false : ['http://localhost:5173', 'http://127.0.0.1:5173'] }));
app.use(express.json({ limit: '32kb' }));

const schoolColumns = `
  p.school_year, s.dbn, s.school_name, s.district, s.borough,
  p.enrollment, p.attendance_pct::float8 AS attendance_pct,
  p.math_pct::float8 AS math_pct, p.ela_pct::float8 AS ela_pct
`;
const fromSchools = `FROM school_performance p JOIN schools s ON p.dbn = s.dbn`;

const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

app.get('/api/health', asyncRoute(async (_req, res) => {
  await pool.query('SELECT 1');
  res.json({ status: 'ok', database: 'connected', application: 'SchoolScope API' });
}));

app.get('/api/metadata', asyncRoute(async (req, res) => {
  const year = typeof req.query.year === 'string' ? req.query.year : '2025-26';
  if (!/^20\d{2}-\d{2}$/.test(year)) return void res.status(400).json({ error: 'Invalid school year' });
  const [years, districts, boroughs, count] = await Promise.all([
    pool.query<{ school_year: string }>('SELECT DISTINCT school_year FROM school_performance ORDER BY school_year DESC'),
    pool.query<{ district: number }>(`SELECT DISTINCT s.district ${fromSchools} WHERE p.school_year = $1 ORDER BY s.district`, [year]),
    pool.query<{ borough: string }>(`SELECT DISTINCT s.borough ${fromSchools} WHERE p.school_year = $1 ORDER BY s.borough`, [year]),
    pool.query<{ count: number }>('SELECT COUNT(*)::int AS count FROM school_performance'),
  ]);
  res.json({ years: years.rows.map(r => r.school_year), districts: districts.rows.map(r => r.district), boroughs: boroughs.rows.map(r => r.borough), records: count.rows[0]?.count ?? 0, isDemo: true });
}));

app.get('/api/schools', asyncRoute(async (req, res) => {
  const filters = parseFilters(req.query);
  const { where, values } = buildWhere(filters);
  const query = `SELECT ${schoolColumns} ${fromSchools} ${where} ORDER BY ${orderBy(filters.sort)}`;
  const { rows } = await pool.query<SchoolRecord>(query, values);
  res.json({ schools: rows, count: rows.length });
}));

app.get('/api/summary', asyncRoute(async (req, res) => {
  const filters = parseFilters(req.query);
  const { where, values } = buildWhere(filters);
  const { rows } = await pool.query(`
    SELECT COUNT(*)::int AS school_count,
      ROUND(AVG(p.math_pct), 1)::float8 AS avg_math,
      ROUND(AVG(p.ela_pct), 1)::float8 AS avg_ela,
      ROUND(AVG(p.attendance_pct), 1)::float8 AS avg_attendance,
      COUNT(p.math_pct)::int AS math_reporting,
      COUNT(p.ela_pct)::int AS ela_reporting,
      COUNT(p.attendance_pct)::int AS attendance_reporting,
      COALESCE(SUM(p.enrollment), 0)::int AS enrolled_students
    ${fromSchools} ${where}
  `, values);
  res.json(rows[0]);
}));

app.get('/api/trends', asyncRoute(async (req, res) => {
  const filters = parseFilters(req.query);
  const { where, values } = buildWhere(filters, false);
  const { rows } = await pool.query(`
    SELECT p.school_year,
      COUNT(*)::int AS school_count,
      ROUND(AVG(p.math_pct), 1)::float8 AS avg_math,
      ROUND(AVG(p.ela_pct), 1)::float8 AS avg_ela,
      ROUND(AVG(p.attendance_pct), 1)::float8 AS avg_attendance
    ${fromSchools} ${where}
    GROUP BY p.school_year ORDER BY p.school_year
  `, values);
  res.json({ years: rows });
}));

app.get('/api/schools/:dbn/history', asyncRoute(async (req, res) => {
  const { rows } = await pool.query<SchoolRecord>(`
    SELECT ${schoolColumns} ${fromSchools}
    WHERE s.dbn = $1 ORDER BY p.school_year DESC
  `, [req.params.dbn]);
  if (!rows.length) return void res.status(404).json({ error: 'School not found' });
  res.json({ history: rows });
}));

app.use('/api', (_req, res) => res.status(404).json({ error: 'Endpoint not found' }));

const handleError: ErrorRequestHandler = (error: unknown, _req, res, _next) => {
  if (error instanceof Error && /^(Invalid|District|Search query)/.test(error.message)) {
    return void res.status(400).json({ error: error.message });
  }
  console.error('API error:', error);
  res.status(500).json({ error: 'Internal server error' });
};
app.use(handleError);

const port = Number(process.env.PORT || 4000);
async function start() {
  await migrateAndSeed();
  const server = app.listen(port, '0.0.0.0', () => console.info(`SchoolScope API listening on :${port}`));
  for (const signal of ['SIGTERM', 'SIGINT']) {
    process.once(signal, () => {
      server.close(() => closePool().finally(() => process.exit(0)));
    });
  }
}
start().catch(error => {
  console.error('Unable to start API:', error);
  process.exit(1);
});
