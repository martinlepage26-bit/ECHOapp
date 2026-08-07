/** Simple per-IP sliding-window rate limiter.
 *
 *  Storage is in-memory, so the limit applies per Worker instance. On the free
 *  tier this is usually one instance; for bursts across many instances the
 *  effective limit is higher, but abuse still cannot exceed the upstream quota.
 */

export interface RateLimitOptions {
  windowMs: number;
  maxRequests: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(private options: RateLimitOptions) {}

  reset(): void {
    this.buckets.clear();
  }

  isAllowed(ip: string, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
    const bucket = this.buckets.get(ip);
    if (!bucket || now >= bucket.resetAt) {
      this.buckets.set(ip, { count: 1, resetAt: now + this.options.windowMs });
      return { allowed: true, retryAfterMs: 0 };
    }

    if (bucket.count < this.options.maxRequests) {
      bucket.count++;
      return { allowed: true, retryAfterMs: 0 };
    }

    return { allowed: false, retryAfterMs: bucket.resetAt - now };
  }
}
