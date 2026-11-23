import { randomBytes, randomInt, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

export const MIN_PASSWORD_LENGTH = 8;
export const MAX_PASSWORD_LENGTH = 256;

const KEY_LENGTH = 32;
const PARAMS = { N: 16384, r: 8, p: 1 };

function scrypt(password: string, salt: Buffer, length: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password.normalize('NFC'), salt, length, options, (error, key) => (error ? reject(error) : resolve(key)));
  });
}

/** What's wrong with a new password, or null */
export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return `Passwords need at least ${MIN_PASSWORD_LENGTH} characters`;
  }
  if (password.length > MAX_PASSWORD_LENGTH) return `Passwords can have at most ${MAX_PASSWORD_LENGTH} characters`;
  return null;
}

/** `scrypt$N$r$p$salt$hash`, with a random salt */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scrypt(password, salt, KEY_LENGTH, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, { N: Number(n), r: Number(r), p: Number(p) });
  return timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | undefined;
/** Checked against when an email has no account, so the answer takes as long as for a wrong password */
export function dummyPasswordHash(): Promise<string> {
  dummy ??= hashPassword(randomBytes(16).toString('hex'));
  return dummy;
}

/** A password that's easy to read out and type: `k7rm-p4wq-z9xt-h3cv`, about 80 bits */
export function generatePassword(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  const group = () => Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return [group(), group(), group(), group()].join('-');
}
