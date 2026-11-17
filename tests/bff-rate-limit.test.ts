import { describe, expect, it } from "vitest";
import { FixedWindowLimiter } from "../packages/auth-bff/src/rate-limit";

describe("fixed-window limiter", () => {
  it("allows up to the limit, then reports a retry delay, then resets with the window", () => {
    const limiter = new FixedWindowLimiter(60_000, 100);
    for (let i = 0; i < 3; i += 1)
      expect(limiter.consume("k", 3, 1000 + i).allowed).toBe(true);
    const denied = limiter.consume("k", 3, 31_000);
    expect(denied).toEqual({ allowed: false, retryAfterSeconds: 30 });
    expect(limiter.consume("k", 3, 61_000).allowed).toBe(true);
  });
  it("counts keys independently", () => {
    const limiter = new FixedWindowLimiter(60_000, 100);
    expect(limiter.consume("a", 1, 0).allowed).toBe(true);
    expect(limiter.consume("a", 1, 1).allowed).toBe(false);
    expect(limiter.consume("b", 1, 2).allowed).toBe(true);
  });
  it("never grows beyond its key limit under key rotation, dropping expired windows first", () => {
    const limiter = new FixedWindowLimiter(60_000, 50);
    for (let i = 0; i < 10_000; i += 1) limiter.consume(`rot-${i}`, 1, i);
    expect(limiter.size).toBeLessThanOrEqual(50);
    // Expired windows are reclaimed before live ones are evicted.
    const fresh = new FixedWindowLimiter(60_000, 10);
    for (let i = 0; i < 10; i += 1) fresh.consume(`old-${i}`, 1, 0);
    fresh.consume("new", 1, 120_000);
    expect(fresh.size).toBe(1);
  });
  it("rejects unsafe configuration", () => {
    expect(() => new FixedWindowLimiter(500, 100)).toThrow();
    expect(() => new FixedWindowLimiter(60_000, 5)).toThrow();
    expect(() => new FixedWindowLimiter(60_000.5, 100)).toThrow();
  });
});
