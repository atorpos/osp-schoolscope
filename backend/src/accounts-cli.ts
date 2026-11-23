// Manages the accounts that can log in, e.g. for reviewers:
//
//   npm run accounts -- list                                   (development)
//   docker compose exec api node dist/accounts-cli.js list     (Docker)
//
// Commands:
//   list                       Accounts, and when each last logged in
//   add <email> [name…]        Creates an account with a generated password, which is printed once
//   reset-password <email>     Generates a new password and ends the account's logins
//   remove <email>             Deletes the account and ends its logins
import { closePool } from './db.js';
import { accountProblem, listAccounts, normalizeEmail, removeAccount, setPassword, upsertAccount } from './auth/accounts.js';
import { generatePassword } from './auth/passwords.js';
import { migrateAuth } from './auth/schema.js';

const usage = `Usage:
  list                       List accounts
  add <email> [name…]        Create an account with a generated password
  reset-password <email>     Generate a new password (ends the account's logins)
  remove <email>             Delete an account`;

async function main(args: string[]): Promise<number> {
  migrateAuth();
  const [command, email, ...nameParts] = args;
  switch (command) {
    case 'list': {
      const accounts = listAccounts();
      if (!accounts.length) console.info('No accounts yet. Add one with: add <email> [name]');
      for (const account of accounts) {
        const state = account.disabled ? ' (disabled)' : '';
        console.info(`${account.email.padEnd(36)} ${account.name.padEnd(24)} last login: ${account.last_login_at ?? 'never'}${state}`);
      }
      return 0;
    }
    case 'add': {
      if (!email) break;
      const password = generatePassword();
      const name = nameParts.join(' ') || undefined;
      const problem = accountProblem({ email, name, password });
      if (problem) {
        console.error(problem);
        return 1;
      }
      if (listAccounts().some(account => account.email === normalizeEmail(email))) {
        console.error(`${normalizeEmail(email)} already has an account. Use reset-password for a new password.`);
        return 1;
      }
      await upsertAccount({ email, name, password });
      console.info(`Created ${normalizeEmail(email)}\nPassword: ${password}\n(Shown once. Share it with the reviewer privately.)`);
      return 0;
    }
    case 'reset-password': {
      if (!email) break;
      const password = generatePassword();
      if (!(await setPassword(email, password))) {
        console.error(`No account for ${normalizeEmail(email)}`);
        return 1;
      }
      console.info(`New password for ${normalizeEmail(email)}: ${password}\nIts existing logins have ended.`);
      return 0;
    }
    case 'remove': {
      if (!email) break;
      if (!removeAccount(email)) {
        console.error(`No account for ${normalizeEmail(email)}`);
        return 1;
      }
      console.info(`Removed ${normalizeEmail(email)}`);
      return 0;
    }
  }
  console.error(usage);
  return 1;
}

main(process.argv.slice(2))
  .then(async code => { await closePool(); process.exit(code); })
  .catch(async error => { console.error(error instanceof Error ? error.message : error); await closePool(); process.exit(1); });
