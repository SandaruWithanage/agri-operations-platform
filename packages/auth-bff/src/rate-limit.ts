/**
 * Fixed-window request limiter held in the memory of one BFF instance. It protects the API and database from
 * floods of valid-looking requests; it is not a replacement for the per-account login throttle in PostgreSQL or for a
 * rate limit at the public edge. A deployment with several BFF instances needs a shared store or edge limiting for
 * a global budget (each instance counts on its own).
 *
 * The key table is bounded: when it is full, expired windows are dropped first and then the oldest entries. A bot
 * that rotates keys can therefore reset other callers' counters but can never grow memory without limit.
 */
export type LimitDecision = { allowed: boolean; retryAfterSeconds: number };
export class FixedWindowLimiter {
  private readonly windows = new Map<
    string,
    { start: number; count: number }
  >();
  constructor(
    private readonly windowMs: number,
    private readonly maxKeys: number,
  ) {
    if (
      !Number.isInteger(windowMs) ||
      windowMs < 1000 ||
      !Number.isInteger(maxKeys) ||
      maxKeys < 10
    )
      throw new Error("Invalid rate limiter configuration");
  }
  consume(key: string, limit: number, now: number): LimitDecision {
    let entry = this.windows.get(key);
    if (!entry || now - entry.start >= this.windowMs) {
      if (!entry && this.windows.size >= this.maxKeys) this.makeRoom(now);
      entry = { start: now, count: 0 };
      // Re-insert so Map iteration order stays oldest-window-first for eviction.
      this.windows.delete(key);
      this.windows.set(key, entry);
    }
    if (entry.count >= limit)
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((entry.start + this.windowMs - now) / 1000),
        ),
      };
    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  get size() {
    return this.windows.size;
  }
  private makeRoom(now: number) {
    for (const [key, entry] of this.windows)
      if (now - entry.start >= this.windowMs) this.windows.delete(key);
    while (this.windows.size >= this.maxKeys) {
      const oldest = this.windows.keys().next().value;
      if (oldest === undefined) break;
      this.windows.delete(oldest);
    }
  }
}
