type Entry = { count: number; expiresAt: number };

/** Small per-process fixed-window limiter. Map size is bounded to avoid key leaks. */
export class FixedWindowLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxKeys = 10_000,
  ) {}

  consume(
    key: string,
    now = Date.now(),
  ): { allowed: boolean; retryAfterMs: number } {
    let entry = this.entries.get(key);
    if (!entry || entry.expiresAt <= now) {
      if (this.entries.size >= this.maxKeys) {
        for (const [oldKey, oldEntry] of this.entries) {
          if (oldEntry.expiresAt <= now) this.entries.delete(oldKey);
        }
        if (this.entries.size >= this.maxKeys)
          this.entries.delete(this.entries.keys().next().value!);
      }
      entry = { count: 0, expiresAt: now + this.windowMs };
      this.entries.set(key, entry);
    }
    entry.count++;
    return {
      allowed: entry.count <= this.limit,
      retryAfterMs: Math.max(0, entry.expiresAt - now),
    };
  }
}
