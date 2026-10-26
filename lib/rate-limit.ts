/**
 * lib/rate-limit.ts
 *
 * A fixed-window counter used as a speed bump in front of the two expensive
 * endpoints. Deliberately tiny and dependency-free.
 *
 * **What this is not.** It is not a guarantee. The counter lives in module
 * memory, so on Vercel every warm instance has its own map, a cold start resets
 * it, and two regions can each allow the full budget. Real per-IP limiting needs
 * shared state (Redis/Upstash), which is a new service and outside the $0 rule.
 *
 * What it does buy: a stuck loop or a double-submit on one warm instance cannot
 * hammer arXiv and the LLM, and the daily per-user quota (10 projects) is no
 * longer the only guard. Documented as best-effort in `decision.md` (D44).
 */

export interface LimitResult {
  ok: boolean;
  remaining: number;
  /** Seconds until the window resets; 0 when the request is allowed. */
  retryAfterSeconds: number;
}

interface Window {
  count: number;
  resetAt: number;
}

const SWEEP_THRESHOLD = 2_000;

export class FixedWindowLimiter {
  private readonly hits = new Map<string, Window>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, now = Date.now()): LimitResult {
    const existing = this.hits.get(key);

    if (!existing || existing.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      this.sweep(now);
      return { ok: true, remaining: this.limit - 1, retryAfterSeconds: 0 };
    }

    existing.count += 1;

    if (existing.count > this.limit) {
      return {
        ok: false,
        remaining: 0,
        retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)),
      };
    }

    return { ok: true, remaining: this.limit - existing.count, retryAfterSeconds: 0 };
  }

  /** Drops expired keys once the map grows, so an attacker cannot leak memory. */
  private sweep(now: number): void {
    if (this.hits.size <= SWEEP_THRESHOLD) return;
    for (const [key, window] of this.hits) {
      if (window.resetAt <= now) this.hits.delete(key);
    }
  }

  /** Test hook only. */
  reset(): void {
    this.hits.clear();
  }
}

/**
 * Per-user budgets. Searching is cheap and cached, generating is not, so the
 * search budget is looser: a shuffle costs one cached arXiv request.
 */
export const papersLimiter = new FixedWindowLimiter(30, 60_000);
export const generateLimiter = new FixedWindowLimiter(6, 60_000);
