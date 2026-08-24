interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt <= now) store.delete(key);
  }
}, 5 * 60 * 1000);

/**
 * Simple in-memory sliding-window rate limiter.
 * Returns true if the request is allowed, false if rate-limited.
 */
export function rateLimit(
  key: string,
  maxAttempts: number,
  windowMs: number,
): boolean {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt <= now) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }

  entry.count++;
  if (entry.count > maxAttempts) return false;
  return true;
}

/**
 * Get remaining attempts for a key (for informational headers).
 */
export function getRemainingAttempts(
  key: string,
  maxAttempts: number,
  windowMs: number,
): number {
  const now = Date.now();
  const entry = store.get(key);
  if (!entry || entry.resetAt <= now) return maxAttempts;
  return Math.max(0, maxAttempts - entry.count);
}

/**
 * Reset rate limit for a key (e.g. after successful login).
 */
export function resetRateLimit(key: string): void {
  store.delete(key);
}
