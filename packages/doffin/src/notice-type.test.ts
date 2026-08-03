import { describe, expect, it } from 'vitest';
import {
  deriveNoticeCategory,
  deriveStatus,
  isPlannedType,
  KNOWN_NOTICE_TYPES,
} from './notice-type.js';

describe('deriveNoticeCategory', () => {
  it.each([
    ['ADVISORY_NOTICE', 'planned'],
    ['PRE_ANNOUNCEMENT', 'planned'],
    ['NOTICE_ON_BUYER_PROFILE', 'planned'],
    ['ANNOUNCEMENT_OF_INTENT', 'planned'],
    ['ANNOUNCEMENT_OF_COMPETITION', 'competition'],
    ['DYNAMIC_PURCHASING_SCHEME', 'competition'],
    ['ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT', 'award'],
    ['CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT', 'award'],
  ] as const)('maps %s to %s', (type, expected) => {
    expect(deriveNoticeCategory(type).value).toBe(expected);
  });

  it('classifies an intention notice as planned, not as an award', () => {
    // The trap this whole module exists for. Doffin tags an
    // intensjonskunngjøring with the RESULT roll-up, identical to a real
    // award. Reading allTypes instead of type would hide every one of them
    // from users who asked for planned procurements.
    const derived = deriveNoticeCategory('ANNOUNCEMENT_OF_INTENT');
    expect(derived.value).toBe('planned');
    expect(derived.value).not.toBe('award');
  });

  it('returns other for an unrecognised type', () => {
    expect(deriveNoticeCategory('SOME_NEW_TYPE').value).toBe('other');
  });

  it('warns loudly about an unrecognised type rather than swallowing it', () => {
    // The Doffin enum is server-side and can gain values without notice. A
    // silent default would mean a new notice type stops reaching users with
    // nothing in the logs to explain why.
    const derived = deriveNoticeCategory('SOME_NEW_TYPE');
    expect(derived.warning).toMatchObject({ field: 'noticeType', value: 'SOME_NEW_TYPE' });
    expect(derived.warning?.message).toContain('SOME_NEW_TYPE');
  });

  it('does not warn for a type it recognises', () => {
    for (const type of KNOWN_NOTICE_TYPES) {
      expect(deriveNoticeCategory(type).warning, `${type} warned`).toBeUndefined();
    }
  });

  it('is case-sensitive, matching the API exactly', () => {
    expect(deriveNoticeCategory('advisory_notice').value).toBe('other');
  });

  it('covers every type the live sample contained', () => {
    expect(KNOWN_NOTICE_TYPES).toHaveLength(8);
  });
});

describe('isPlannedType', () => {
  it('is true for the four planned types', () => {
    expect(isPlannedType('ADVISORY_NOTICE')).toBe(true);
    expect(isPlannedType('ANNOUNCEMENT_OF_INTENT')).toBe(true);
  });

  it('is false for a competition and for an award', () => {
    expect(isPlannedType('ANNOUNCEMENT_OF_COMPETITION')).toBe(false);
    expect(isPlannedType('ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT')).toBe(false);
  });
});

describe('deriveStatus', () => {
  it('reads an award as awarded regardless of the status field', () => {
    expect(
      deriveStatus({ type: 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT', status: null }).value,
    ).toBe('awarded');
  });

  it('reads a cancelled-contract notice as cancelled', () => {
    expect(
      deriveStatus({ type: 'CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT', status: null }).value,
    ).toBe('cancelled');
  });

  it('lets the notice type win over a stale status on an award', () => {
    // Type is the more reliable signal: status is only maintained for live
    // competitions, so anything it says about an award is incidental.
    expect(
      deriveStatus({ type: 'ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT', status: 'ACTIVE' }).value,
    ).toBe('awarded');
  });

  it.each([
    ['ACTIVE', 'open'],
    ['EXPIRED', 'closed'],
    ['CANCELLED', 'cancelled'],
  ] as const)('maps competition status %s to %s', (status, expected) => {
    expect(deriveStatus({ type: 'ANNOUNCEMENT_OF_COMPETITION', status }).value).toBe(expected);
  });

  it('treats a null status on a planned notice as unknown, without warning', () => {
    // Planned notices have no competition state at all, so this is expected
    // rather than a data gap worth alerting on.
    const derived = deriveStatus({ type: 'ADVISORY_NOTICE', status: null });
    expect(derived.value).toBe('unknown');
    expect(derived.warning).toBeUndefined();
  });

  it('treats a missing status the same as an explicit null', () => {
    expect(deriveStatus({ type: 'ADVISORY_NOTICE', status: undefined }).value).toBe('unknown');
  });

  it('warns about a status value it does not recognise', () => {
    const derived = deriveStatus({ type: 'ANNOUNCEMENT_OF_COMPETITION', status: 'PAUSED' });
    expect(derived.value).toBe('unknown');
    expect(derived.warning).toMatchObject({ field: 'status', value: 'PAUSED' });
  });
});
