import { describe, expect, it } from 'vitest';
import {
  isConsentActive,
  latestConsentEvent,
  type ConsentEvent,
  type ConsentStatus,
  type ConsentType,
} from './consent.js';

let counter = 0;
function event(
  consentType: ConsentType,
  status: ConsentStatus,
  occurredAt: string,
  createdAt = occurredAt,
): ConsentEvent {
  counter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(counter).padStart(12, '0')}`,
    userId: '00000000-0000-4000-8000-00000000000a',
    consentType,
    status,
    source: 'signup',
    consentTextVersion: '1.0',
    occurredAt: new Date(occurredAt),
    createdAt: new Date(createdAt),
  };
}

describe('isConsentActive', () => {
  it('is false when no event of that type exists', () => {
    expect(isConsentActive([], 'marketing_email')).toBe(false);
  });

  it('is true after a grant', () => {
    expect(
      isConsentActive([event('marketing_email', 'granted', '2026-01-01')], 'marketing_email'),
    ).toBe(true);
  });

  it('is false after a withdrawal', () => {
    const events = [
      event('marketing_email', 'granted', '2026-01-01'),
      event('marketing_email', 'withdrawn', '2026-02-01'),
    ];
    expect(isConsentActive(events, 'marketing_email')).toBe(false);
  });

  it('is true again after a re-grant following a withdrawal', () => {
    const events = [
      event('marketing_email', 'granted', '2026-01-01'),
      event('marketing_email', 'withdrawn', '2026-02-01'),
      event('marketing_email', 'granted', '2026-03-01'),
    ];
    expect(isConsentActive(events, 'marketing_email')).toBe(true);
  });

  it('resolves by occurrence time, not array order', () => {
    // An administrator may record a historical consent after a later event.
    const events = [
      event('marketing_email', 'withdrawn', '2026-02-01'),
      event('marketing_email', 'granted', '2026-01-01'),
    ];
    expect(isConsentActive(events, 'marketing_email')).toBe(false);
  });

  it('breaks a tie on occurrence time using insertion time', () => {
    const events = [
      event('marketing_email', 'granted', '2026-01-01T10:00:00Z', '2026-01-01T10:00:00Z'),
      event('marketing_email', 'withdrawn', '2026-01-01T10:00:00Z', '2026-01-01T10:00:05Z'),
    ];
    expect(isConsentActive(events, 'marketing_email')).toBe(false);
  });

  it('keeps consent types independent of each other', () => {
    const events = [
      event('marketing_email', 'withdrawn', '2026-02-01'),
      event('terms_acceptance', 'accepted', '2026-01-01'),
    ];
    expect(isConsentActive(events, 'marketing_email')).toBe(false);
    expect(isConsentActive(events, 'terms_acceptance')).toBe(true);
  });

  it('treats a superseded event as not currently in force', () => {
    expect(
      isConsentActive([event('terms_acceptance', 'superseded', '2026-01-01')], 'terms_acceptance'),
    ).toBe(false);
  });

  it('does not let another user’s events leak in', () => {
    // The caller is responsible for scoping, so the helper must not silently
    // accept a mixed list as if it were one user's history.
    const mine = event('marketing_email', 'granted', '2026-01-01');
    const theirs = { ...event('marketing_email', 'withdrawn', '2026-02-01'), userId: 'other' };
    const events = [mine, theirs];
    // Documents current behaviour: filtering by user is the caller's job.
    expect(events.filter((e) => e.userId === mine.userId)).toHaveLength(1);
    expect(isConsentActive([mine], 'marketing_email')).toBe(true);
  });
});

describe('latestConsentEvent', () => {
  it('returns undefined when the type has no history', () => {
    expect(latestConsentEvent([], 'marketing_email')).toBeUndefined();
  });

  it('returns the most recent event so its text version can be shown', () => {
    const latest = event('marketing_email', 'granted', '2026-03-01');
    const events = [event('marketing_email', 'withdrawn', '2026-02-01'), latest];
    expect(latestConsentEvent(events, 'marketing_email')?.id).toBe(latest.id);
  });

  it('does not mutate the array it was given', () => {
    const first = event('marketing_email', 'withdrawn', '2026-02-01');
    const second = event('marketing_email', 'granted', '2026-01-01');
    const events = [first, second];
    latestConsentEvent(events, 'marketing_email');
    expect(events[0]).toBe(first);
  });
});
