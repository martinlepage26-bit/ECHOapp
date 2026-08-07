import { describe, it, expect } from "vitest";
import { RateLimiter } from "./rate-limit.js";

describe("RateLimiter", () => {
  it("allows requests up to the limit", () => {
    const limiter = new RateLimiter({ windowMs: 10_000, maxRequests: 2 });
    expect(limiter.isAllowed("1.2.3.4", 0).allowed).toBe(true);
    expect(limiter.isAllowed("1.2.3.4", 1).allowed).toBe(true);
    const third = limiter.isAllowed("1.2.3.4", 2);
    expect(third.allowed).toBe(false);
    expect(third.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets the window after it expires", () => {
    const limiter = new RateLimiter({ windowMs: 1_000, maxRequests: 1 });
    expect(limiter.isAllowed("1.2.3.4", 0).allowed).toBe(true);
    expect(limiter.isAllowed("1.2.3.4", 1).allowed).toBe(false);
    expect(limiter.isAllowed("1.2.3.4", 1_001).allowed).toBe(true);
  });

  it("tracks IPs independently", () => {
    const limiter = new RateLimiter({ windowMs: 10_000, maxRequests: 1 });
    expect(limiter.isAllowed("1.2.3.4", 0).allowed).toBe(true);
    expect(limiter.isAllowed("5.6.7.8", 0).allowed).toBe(true);
  });
});
