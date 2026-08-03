import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.js';

const T0 = new Date('2026-08-03T10:00:00.000Z');
const at = (ms: number) => new Date(T0.getTime() + ms);

/** Comfortably past the two-window eviction horizon. */
const IDLE_MS = 200_000;

/** Sends `n` requests at one instant and returns how many were allowed. */
function drive(
  limiter: ReturnType<typeof createRateLimiter>,
  n: number,
  now: Date,
  tokenId = 'token-a',
  userId = 'user-1',
): number {
  let allowed = 0;
  for (let i = 0; i < n; i += 1) {
    if (limiter.check(tokenId, userId, now).allowed) allowed += 1;
  }
  return allowed;
}

describe('createRateLimiter', () => {
  it('allows traffic up to the token limit and refuses the next call', () => {
    const limiter = createRateLimiter({ tokenLimitPerMinute: 5, userLimitPerMinute: 100 });
    expect(drive(limiter, 5, T0)).toBe(5);
    const decision = limiter.check('token-a', 'user-1', T0);
    expect(decision.allowed).toBe(false);
    expect(decision.limitedBy).toBe('token');
  });

  it('reports a retry-after inside the window rather than zero', () => {
    const limiter = createRateLimiter({ tokenLimitPerMinute: 1, userLimitPerMinute: 100 });
    limiter.check('token-a', 'user-1', T0);
    const decision = limiter.check('token-a', 'user-1', T0);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  // §30 requires both keys. Each of the next two tests fails if either is dropped.
  it('counts a user across their separate tokens', () => {
    const limiter = createRateLimiter({ tokenLimitPerMinute: 100, userLimitPerMinute: 6 });
    expect(drive(limiter, 4, T0, 'token-a', 'user-1')).toBe(4);
    expect(drive(limiter, 4, T0, 'token-b', 'user-1')).toBe(2);
    expect(limiter.check('token-c', 'user-1', T0).limitedBy).toBe('user');
  });

  it('keeps one user clear of another', () => {
    const limiter = createRateLimiter({ tokenLimitPerMinute: 2, userLimitPerMinute: 2 });
    expect(drive(limiter, 2, T0, 'token-a', 'user-1')).toBe(2);
    expect(drive(limiter, 2, T0, 'token-b', 'user-2')).toBe(2);
  });

  // Otherwise one runaway token starves every other integration its owner has.
  // The noisy token sends far past its own limit; only the two it was entitled
  // to may count against the user, leaving the other tokens their full share.
  it('does not spend the user budget on a request the token limit already refused', () => {
    const limiter = createRateLimiter({ tokenLimitPerMinute: 2, userLimitPerMinute: 10 });
    expect(drive(limiter, 20, T0, 'noisy', 'user-1')).toBe(2);
    const others = ['quiet-a', 'quiet-b', 'quiet-c', 'quiet-d'];
    const allowed = others.reduce((sum, token) => sum + drive(limiter, 2, T0, token, 'user-1'), 0);
    expect(allowed).toBe(8);
    // 2 + 8 exhausts the user budget exactly, so the next one is refused by it.
    expect(limiter.check('quiet-e', 'user-1', T0).limitedBy).toBe('user');
  });

  it('lets traffic through again in the next window', () => {
    const limiter = createRateLimiter({ tokenLimitPerMinute: 3, userLimitPerMinute: 100 });
    expect(drive(limiter, 3, T0)).toBe(3);
    expect(drive(limiter, 3, at(61_000))).toBeGreaterThan(0);
  });

  // A plain fixed window would allow a full limit at the end of one window and
  // another immediately after — twice the allowance within a moment.
  it('does not permit a double burst across a window boundary', () => {
    const limiter = createRateLimiter({ tokenLimitPerMinute: 10, userLimitPerMinute: 1000 });
    const justBeforeBoundary = at(59_000);
    const justAfterBoundary = at(61_000);
    const first = drive(limiter, 10, justBeforeBoundary);
    const second = drive(limiter, 10, justAfterBoundary);
    expect(first).toBe(10);
    expect(first + second).toBeLessThan(20);
  });

  it('forgets a window that was idle rather than carrying its count forward', () => {
    const limiter = createRateLimiter({ tokenLimitPerMinute: 4, userLimitPerMinute: 100 });
    expect(drive(limiter, 4, T0)).toBe(4);
    // Two windows later the earlier burst must not still be weighing on it.
    expect(drive(limiter, 4, at(150_000))).toBe(4);
  });

  // Without eviction, a flood of distinct tokens turns this defence into the
  // memory leak the flood was after.
  it('evicts idle keys so memory does not grow with the number of tokens seen', () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 500; i += 1) {
      limiter.check(`token-${i}`, `user-${i}`, T0);
    }
    expect(limiter.size()).toBe(1000);
    limiter.check('token-later', 'user-later', at(IDLE_MS));
    expect(limiter.size()).toBeLessThan(100);
  });
});
