/**
 * A small in-memory rate limiter for the public actions (signing a proposal),
 * which better-auth's limiter doesn't cover. Per process and forgotten on a
 * restart, which is the right weight for what it guards: it slows down a
 * script hammering one endpoint, it is not a security boundary. The link's
 * signature, the input caps and the one-time claim are what keep the data
 * safe.
 *
 * A sliding window: each key keeps the times of its recent accepted attempts.
 * Refused attempts aren't recorded, so a blocked caller is let back in as soon
 * as its oldest attempt leaves the window. The map is capped; past the cap the
 * least recently used keys are dropped, so a flood of distinct keys can't grow
 * it without bound.
 */

export type RateLimitDecision = { ok: true } | { ok: false; retryAfterMs: number };

export type RateLimiter = {
  /** Counts an attempt for `key` unless it is over the limit. */
  take(key: string, now?: number): RateLimitDecision;
};

export function createRateLimiter(opts: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}): RateLimiter {
  const { limit, windowMs } = opts;
  const maxKeys = opts.maxKeys ?? 5000;
  const hits = new Map<string, number[]>();

  return {
    take(key, now = Date.now()) {
      const recent = (hits.get(key) ?? []).filter((t) => t > now - windowMs);
      // Re-inserting moves the key to the end: the map's order is its LRU order.
      hits.delete(key);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return { ok: false, retryAfterMs: recent[0] + windowMs - now };
      }
      recent.push(now);
      hits.set(key, recent);
      while (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest === undefined) break;
        hits.delete(oldest);
      }
      return { ok: true };
    },
  };
}
