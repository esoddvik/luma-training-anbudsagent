/**
 * Rate limiting for the MCP surface (spec §30, "Rate limiting per token og per
 * bruker").
 *
 * Both keys are required by the spec and neither substitutes for the other. A
 * per-token limit alone lets one user mint ten tokens and pay ten times the
 * budget; a per-user limit alone lets one runaway script consume the whole
 * allowance and starve that user's other integrations. So a request must pass
 * both.
 *
 * **The numbers below are ours, not the specification's.** §30 requires that
 * rate limiting exist and states no figures. They are chosen to sit far above
 * an interactive assistant — a conversational client makes a handful of calls
 * per turn — while still bounding a loop. Change them freely; nothing in the
 * spec is contradicted by doing so.
 *
 * **Scope is one process.** Counters live in memory, so with several instances
 * behind a load balancer the effective limit is per instance times instances.
 * That is a deliberate trade: the alternative is a database round trip on
 * every MCP call, which would put a write on the hot path of the live demo
 * surface to bound something bearer auth already gates. Documented rather than
 * hidden, because an operator reading "120 per minute" should not be surprised
 * to measure 240.
 */

/** Requests per minute for a single token. */
export const DEFAULT_TOKEN_LIMIT_PER_MINUTE = 120;

/** Requests per minute across every token belonging to one user. */
export const DEFAULT_USER_LIMIT_PER_MINUTE = 300;

const WINDOW_MS = 60_000;

/** How long an idle key is kept before the sweep discards it. */
const IDLE_EVICTION_MS = WINDOW_MS * 2;

interface Counter {
  /** Start of the window this counter is currently accumulating into. */
  windowStart: number;
  count: number;
  /** Count from the immediately preceding window, or 0 if that window was idle. */
  previousCount: number;
}

export interface RateLimitDecision {
  readonly allowed: boolean;
  /** Seconds to wait before retrying. Zero when allowed. */
  readonly retryAfterSeconds: number;
  /** Which limit rejected the call, for the log line. Undefined when allowed. */
  readonly limitedBy?: 'token' | 'user';
}

export interface RateLimiterOptions {
  readonly tokenLimitPerMinute?: number;
  readonly userLimitPerMinute?: number;
}

export interface RateLimiter {
  /**
   * Records one request and says whether it may proceed.
   *
   * Call once per request, after authentication — an unauthenticated caller
   * has no token or user to attribute the request to, and is already rejected.
   */
  check(tokenId: string, userId: string, now: Date): RateLimitDecision;
  /** Number of tracked keys. Exposed so a test can assert memory is bounded. */
  size(): number;
}

/**
 * Weighted count across the current and previous window.
 *
 * A plain fixed window lets a client send a full allowance in the last instant
 * of one window and another immediately after, so twice the limit passes in a
 * moment. Weighting the previous window by how much of the current one is left
 * removes that edge without keeping a timestamp per request.
 */
function weightedCount(counter: Counter, now: number): number {
  const elapsed = now - counter.windowStart;
  const previousWeight = Math.max(0, 1 - elapsed / WINDOW_MS);
  return counter.previousCount * previousWeight + counter.count;
}

function roll(counter: Counter, windowStart: number): void {
  if (counter.windowStart === windowStart) return;
  // Only the window immediately before this one carries over. Anything older
  // means the key was idle, and its count must not leak into a fresh window.
  counter.previousCount = counter.windowStart === windowStart - WINDOW_MS ? counter.count : 0;
  counter.count = 0;
  counter.windowStart = windowStart;
}

export function createRateLimiter(options: RateLimiterOptions = {}): RateLimiter {
  const tokenLimit = options.tokenLimitPerMinute ?? DEFAULT_TOKEN_LIMIT_PER_MINUTE;
  const userLimit = options.userLimitPerMinute ?? DEFAULT_USER_LIMIT_PER_MINUTE;

  // Keyed by `t:<tokenId>` and `u:<userId>` in one map. Prefixed so a token id
  // can never collide with a user id and spend the other's budget.
  const counters = new Map<string, Counter>();
  let lastSweep = 0;

  /**
   * Drops keys idle for two windows.
   *
   * Without this the map grows once per distinct token seen and never shrinks,
   * which turns a defence against request floods into a memory leak driven by
   * the same flood.
   */
  function sweep(now: number): void {
    if (now - lastSweep < WINDOW_MS) return;
    lastSweep = now;
    for (const [key, counter] of counters) {
      if (now - counter.windowStart >= IDLE_EVICTION_MS) counters.delete(key);
    }
  }

  function evaluate(key: string, limit: number, now: number, windowStart: number): boolean {
    let counter = counters.get(key);
    if (!counter) {
      counter = { windowStart, count: 0, previousCount: 0 };
      counters.set(key, counter);
    }
    roll(counter, windowStart);
    if (weightedCount(counter, now) >= limit) return false;
    counter.count += 1;
    return true;
  }

  return {
    check(tokenId, userId, now) {
      const millis = now.getTime();
      sweep(millis);
      const windowStart = Math.floor(millis / WINDOW_MS) * WINDOW_MS;
      const retryAfterSeconds = Math.max(1, Math.ceil((windowStart + WINDOW_MS - millis) / 1000));

      // Token first, and the user counter is left untouched when the token
      // limit rejects. Charging both would let one misbehaving token exhaust
      // the budget of every other token the same user owns.
      if (!evaluate(`t:${tokenId}`, tokenLimit, millis, windowStart)) {
        return { allowed: false, retryAfterSeconds, limitedBy: 'token' };
      }
      if (!evaluate(`u:${userId}`, userLimit, millis, windowStart)) {
        return { allowed: false, retryAfterSeconds, limitedBy: 'user' };
      }
      return { allowed: true, retryAfterSeconds: 0 };
    },
    size() {
      return counters.size;
    },
  };
}
