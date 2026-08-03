import { describe, expect, it } from 'vitest';
import { digestIdempotencyKey, isDue, isWeeklySendDay, localHourIn } from './digest.js';
import type { DigestCandidate } from './digest.js';

function candidate(overrides: Partial<DigestCandidate> = {}): DigestCandidate {
  return {
    userId: 'user-1',
    email: 'anbud@entreprenor.no',
    alertProfileId: 'profile-1',
    profileName: 'Bygg og rehabilitering',
    frequency: 'daily',
    timezone: 'Europe/Oslo',
    digestHourLocal: 7,
    includePromotions: true,
    ...overrides,
  };
}

describe('localHourIn', () => {
  it('reports the local hour in Oslo during winter time', () => {
    // 06:30 UTC in January is 07:30 in Oslo (UTC+1).
    expect(localHourIn(new Date('2026-01-15T06:30:00Z'), 'Europe/Oslo')).toBe(7);
  });

  it('reports the local hour in Oslo during summer time', () => {
    // The same UTC instant in July is 08:30 in Oslo (UTC+2). This is the case
    // that a fixed offset gets wrong for half the year.
    expect(localHourIn(new Date('2026-07-15T06:30:00Z'), 'Europe/Oslo')).toBe(8);
  });

  it('handles a timezone on the other side of UTC', () => {
    expect(localHourIn(new Date('2026-01-15T06:30:00Z'), 'America/New_York')).toBe(1);
  });

  it('returns midnight as 0 rather than 24', () => {
    expect(localHourIn(new Date('2026-01-15T23:00:00Z'), 'Europe/Oslo')).toBe(0);
  });

  it('returns null for an unknown timezone instead of throwing', () => {
    // One bad row must not take the whole scheduler tick down.
    expect(localHourIn(new Date('2026-01-15T06:30:00Z'), 'Mars/Olympus')).toBeNull();
  });
});

describe('isWeeklySendDay', () => {
  it('is true on a Monday', () => {
    expect(isWeeklySendDay(new Date('2026-08-10T06:00:00Z'), 'Europe/Oslo')).toBe(true);
  });

  it('is false on other days', () => {
    expect(isWeeklySendDay(new Date('2026-08-11T06:00:00Z'), 'Europe/Oslo')).toBe(false);
  });

  it('uses the recipient timezone, not UTC', () => {
    // 23:30 UTC on Sunday is already Monday in Oslo.
    expect(isWeeklySendDay(new Date('2026-08-09T23:30:00Z'), 'Europe/Oslo')).toBe(true);
  });
});

describe('isDue', () => {
  it('is true for a daily profile at its local hour', () => {
    expect(isDue(candidate(), new Date('2026-01-15T06:30:00Z'))).toBe(true);
  });

  it('is false an hour before', () => {
    expect(isDue(candidate(), new Date('2026-01-15T05:30:00Z'))).toBe(false);
  });

  it('stays correct across daylight saving', () => {
    // A 07:00 Oslo digest must go out at 06:00 UTC in summer, not 05:00. This
    // is the bug an offset-based implementation ships twice a year.
    const summerCorrect = new Date('2026-07-15T05:30:00Z');
    expect(isDue(candidate(), summerCorrect)).toBe(true);
    expect(isDue(candidate(), new Date('2026-07-15T06:30:00Z'))).toBe(false);
  });

  it('is true for a weekly profile only on Monday', () => {
    const weekly = candidate({ frequency: 'weekly' });
    expect(isDue(weekly, new Date('2026-08-10T05:30:00Z'))).toBe(true);
    expect(isDue(weekly, new Date('2026-08-11T05:30:00Z'))).toBe(false);
  });

  it('never schedules a digest for an immediate-only profile', () => {
    expect(isDue(candidate({ frequency: 'immediate' }), new Date('2026-01-15T06:30:00Z'))).toBe(
      false,
    );
  });

  it('respects a profile in a different timezone', () => {
    const newYork = candidate({ timezone: 'America/New_York', digestHourLocal: 7 });
    expect(isDue(newYork, new Date('2026-01-15T12:30:00Z'))).toBe(true);
    expect(isDue(newYork, new Date('2026-01-15T06:30:00Z'))).toBe(false);
  });

  it('is false rather than throwing for an unknown timezone', () => {
    expect(isDue(candidate({ timezone: 'Not/AZone' }), new Date('2026-01-15T06:30:00Z'))).toBe(
      false,
    );
  });
});

describe('digestIdempotencyKey', () => {
  const base = {
    alertProfileId: 'profile-1',
    kind: 'daily_digest' as const,
    timezone: 'Europe/Oslo',
  };

  it('is identical across the four ticks inside one hour', () => {
    // The scheduler runs every fifteen minutes. Without this, a single
    // morning would produce four copies of the same digest.
    const keys = [
      digestIdempotencyKey({ ...base, now: new Date('2026-01-15T06:00:00Z') }),
      digestIdempotencyKey({ ...base, now: new Date('2026-01-15T06:15:00Z') }),
      digestIdempotencyKey({ ...base, now: new Date('2026-01-15T06:30:00Z') }),
      digestIdempotencyKey({ ...base, now: new Date('2026-01-15T06:45:00Z') }),
    ];
    expect(new Set(keys).size).toBe(1);
  });

  it('differs the next day', () => {
    expect(digestIdempotencyKey({ ...base, now: new Date('2026-01-15T06:30:00Z') })).not.toBe(
      digestIdempotencyKey({ ...base, now: new Date('2026-01-16T06:30:00Z') }),
    );
  });

  it('differs between profiles', () => {
    expect(digestIdempotencyKey({ ...base, now: new Date('2026-01-15T06:30:00Z') })).not.toBe(
      digestIdempotencyKey({
        ...base,
        alertProfileId: 'profile-2',
        now: new Date('2026-01-15T06:30:00Z'),
      }),
    );
  });

  it('differs between a daily and a weekly digest', () => {
    expect(digestIdempotencyKey({ ...base, now: new Date('2026-01-15T06:30:00Z') })).not.toBe(
      digestIdempotencyKey({
        ...base,
        kind: 'weekly_digest',
        now: new Date('2026-01-15T06:30:00Z'),
      }),
    );
  });

  it('uses the local calendar day, not the UTC one', () => {
    // 23:30 UTC is already the next day in Oslo, and the key must say so or a
    // late-evening digest would collide with the previous day's.
    const key = digestIdempotencyKey({ ...base, now: new Date('2026-01-15T23:30:00Z') });
    expect(key).toContain('2026-01-16');
  });

  it('names the profile and the kind so a key is diagnosable by eye', () => {
    const key = digestIdempotencyKey({ ...base, now: new Date('2026-01-15T06:30:00Z') });
    expect(key).toMatch(/^daily_digest:profile-1:2026-01-15T\d{2}$/);
  });
});
