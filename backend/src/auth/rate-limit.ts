/** Counts failed attempts per key in memory, e.g. wrong passwords per address and email */
export class FailureLimiter {
  private readonly entries = new Map<string, { failures: number; resetAt: number }>();

  constructor(private readonly limit: number, private readonly windowMs: number) {}

  /** Seconds until the key may try again; 0 when it may now */
  retryAfter(key: string, now = Date.now()): number {
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) return 0;
    return entry.failures >= this.limit ? Math.ceil((entry.resetAt - now) / 1000) : 0;
  }

  fail(key: string, now = Date.now()): void {
    if (this.entries.size > 10_000) this.prune(now);
    const entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) this.entries.set(key, { failures: 1, resetAt: now + this.windowMs });
    else entry.failures++;
  }

  clear(key: string): void {
    this.entries.delete(key);
  }

  private prune(now: number): void {
    for (const [key, entry] of this.entries) if (entry.resetAt <= now) this.entries.delete(key);
  }
}
