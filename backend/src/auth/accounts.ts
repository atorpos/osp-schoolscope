import { db } from '../db.js';
import { hashPassword, passwordProblem, verifyPassword } from './passwords.js';

export interface Account {
  id: number;
  email: string;
  name: string;
  disabled: boolean;
  created_at: string;
  last_login_at: string | null;
}

export interface AccountInput {
  email: string;
  name?: string;
  password: string;
}

/** Used when DEMO_ACCOUNTS isn't set outside production and there are no accounts yet */
export const DEVELOPMENT_ACCOUNT = {
  email: 'reviewer@schoolscope.test',
  name: 'App Reviewer',
  password: 'schoolscope-review',
} as const;

export const normalizeEmail = (email: string): string => email.trim().toLowerCase();

/** What's wrong with an account to create, or null */
export function accountProblem({ email, name, password }: Partial<AccountInput>): string | null {
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return `Invalid email: ${String(email)}`;
  }
  if (name !== undefined && (typeof name !== 'string' || name.trim().length > 100)) return `Invalid name for ${email}`;
  const problem = passwordProblem(password);
  return problem ? `${problem} (${email})` : null;
}

const displayName = (input: AccountInput) => input.name?.trim() || normalizeEmail(input.email).split('@')[0];

function endLogins(userId: number): void {
  db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL').run(Date.now(), userId);
}

/**
 * Creates the account, or brings an existing one in line: its name, enabled, and the password (a changed
 * password ends its logins). Throws when the input isn't valid.
 */
export async function upsertAccount(input: AccountInput): Promise<'created' | 'updated' | 'unchanged'> {
  const problem = accountProblem(input);
  if (problem) throw new Error(problem);
  const email = normalizeEmail(input.email);
  const name = displayName(input);
  const existing = db.prepare('SELECT id, name, password_hash, disabled FROM users WHERE email = ?').get(email) as
    | { id: number; name: string; password_hash: string; disabled: number }
    | undefined;

  if (!existing) {
    db.prepare('INSERT INTO users (email, name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(email, name, await hashPassword(input.password), new Date().toISOString());
    return 'created';
  }
  let changed = false;
  if (existing.name !== name || existing.disabled) {
    db.prepare('UPDATE users SET name = ?, disabled = 0 WHERE id = ?').run(name, existing.id);
    changed = true;
  }
  if (!(await verifyPassword(input.password, existing.password_hash))) {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(input.password), existing.id);
    endLogins(existing.id);
    changed = true;
  }
  return changed ? 'updated' : 'unchanged';
}

/** Sets a new password and ends the account's logins. False when there's no such account. */
export async function setPassword(email: string, password: string): Promise<boolean> {
  const problem = passwordProblem(password);
  if (problem) throw new Error(problem);
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(normalizeEmail(email)) as { id: number } | undefined;
  if (!user) return false;
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(await hashPassword(password), user.id);
  endLogins(user.id);
  return true;
}

/** Deletes the account and its logins. False when there's no such account. */
export function removeAccount(email: string): boolean {
  return Number(db.prepare('DELETE FROM users WHERE email = ?').run(normalizeEmail(email)).changes) > 0;
}

export function listAccounts(): Account[] {
  const rows = db.prepare('SELECT id, email, name, disabled, created_at, last_login_at FROM users ORDER BY email').all() as
    unknown as Array<Omit<Account, 'disabled'> & { disabled: number }>;
  return rows.map(row => ({ ...row, disabled: row.disabled === 1 }));
}

/**
 * DEMO_ACCOUNTS is a JSON array of reviewer accounts:
 * `[{"email":"reviewer@example.com","password":"…","name":"App Reviewer"}]`
 */
export function parseDemoAccounts(raw: string): AccountInput[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('DEMO_ACCOUNTS must be a JSON array, e.g. [{"email":"reviewer@example.com","password":"…","name":"App Reviewer"}]');
  }
  if (!Array.isArray(parsed)) throw new Error('DEMO_ACCOUNTS must be a JSON array of accounts');
  return parsed.map((entry: Partial<AccountInput>) => {
    const problem = accountProblem(entry ?? {});
    if (problem) throw new Error(`DEMO_ACCOUNTS: ${problem}`);
    return { email: entry.email!, name: entry.name, password: entry.password! };
  });
}

/** Creates or updates the reviewer accounts in DEMO_ACCOUNTS on startup. Passwords are never logged. */
export async function syncDemoAccounts(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const raw = env.DEMO_ACCOUNTS?.trim();
  if (raw) {
    const results: string[] = [];
    for (const account of parseDemoAccounts(raw)) {
      results.push(`${normalizeEmail(account.email)} (${await upsertAccount(account)})`);
    }
    console.info(`Reviewer accounts ready: ${results.join(', ')}`);
    return;
  }
  const { count } = db.prepare('SELECT COUNT(*) AS count FROM users').get() as { count: number };
  if (count > 0) return;
  if (env.NODE_ENV !== 'production') {
    await upsertAccount(DEVELOPMENT_ACCOUNT);
    console.info(`Development account created: ${DEVELOPMENT_ACCOUNT.email} / ${DEVELOPMENT_ACCOUNT.password}`);
    return;
  }
  console.warn('No accounts can log in yet. Set DEMO_ACCOUNTS, or run: node dist/accounts-cli.js add <email> [name]');
}
