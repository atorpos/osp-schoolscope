import { db } from '../db.js';

/** Creates the account and login tables if needed, and deletes logins that ended over a month ago */
export function migrateAuth(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      disabled INTEGER NOT NULL DEFAULT 0 CHECK (disabled IN (0, 1)),
      created_at TEXT NOT NULL,
      last_login_at TEXT
    );
    -- One row per login (device / browser). The refresh token is replaced on every renewal; the one it
    -- replaced is kept to notice it being used again, which ends the login.
    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      refresh_hash TEXT NOT NULL UNIQUE,
      previous_refresh_hash TEXT,
      rotated_at INTEGER,
      expires_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      last_used_at INTEGER NOT NULL,
      user_agent TEXT,
      ip TEXT,
      revoked_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS auth_sessions_previous_idx ON auth_sessions (previous_refresh_hash);
    CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions (user_id);
  `);
  const monthAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  db.prepare('DELETE FROM auth_sessions WHERE expires_at < ? OR revoked_at < ?').run(monthAgo, monthAgo);
}
