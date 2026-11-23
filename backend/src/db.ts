import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';

const path = process.env.SQLITE_PATH || './data/schoolscope.sqlite';
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });

export const db = new DatabaseSync(path);
db.exec('PRAGMA foreign_keys = ON');
// SQLite's built-in lower() only handles ASCII. Preserve case-insensitive
// searches for the fictional names containing accented characters.
db.function('casefold', { deterministic: true }, (value) =>
  typeof value === 'string' ? value.toLowerCase() : null,
);

export const pool = {
  async query<T = Record<string, unknown>>(sql: string, values: SQLInputValue[] = []): Promise<{ rows: T[] }> {
    const rows = db.prepare(sql).all(...values) as unknown as T[];
    return { rows };
  },
};

export async function closePool(): Promise<void> {
  db.close();
}
