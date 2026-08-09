import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  buildSourceUrl,
  extractWinners,
  hashPayload,
  NATIONWIDE_LOCATION,
  normalizeSearchHit,
  parsePublicationDate,
  partitionLocations,
} from './normalize.js';
import { doffinSearchHitSchema, doffinSearchResponseSchema } from './source-notice.js';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const now = new Date('2026-08-04T09:00:00Z');

function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8'));
}

/** Captured from the live API; see docs/doffin-api-findings.md. */
const FIXTURE_FILES = {
  competition: 'contract-notice.json',
  planned: 'prior-information-notice.json',
  intention: 'intention-notice.json',
  award: 'contract-award-notice.json',
} as const;

describe('the captured fixtures', () => {
  it.each(Object.entries(FIXTURE_FILES))('parses %s against the source schema', (_kind, file) => {
    expect(() => doffinSearchHitSchema.parse(loadFixture(file))).not.toThrow();
  });

  it('parses the search envelope, including its 1000-hit ceiling field', () => {
    const parsed = doffinSearchResponseSchema.parse(loadFixture('search-response-page.json'));
    expect(parsed.numHitsAccessible).toBeLessThanOrEqual(1000);
    expect(parsed.hits.length).toBeGreaterThan(0);
  });
});

describe('notice categorisation against real payloads', () => {
  it('categorises a contract notice as a competition', () => {
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.competition));
    expect(normalizeSearchHit(hit, { now }).tender.noticeCategory).toBe('competition');
  });

  it('categorises a prior information notice as planned', () => {
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.planned));
    expect(normalizeSearchHit(hit, { now }).tender.noticeCategory).toBe('planned');
  });

  it('categorises an intention notice as planned despite its RESULT roll-up', () => {
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.intention));
    // Real payload, real trap: allTypes says RESULT here.
    expect(hit.allTypes).toContain('RESULT');
    expect(normalizeSearchHit(hit, { now }).tender.noticeCategory).toBe('planned');
  });

  it('categorises an award notice as an award', () => {
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.award));
    expect(normalizeSearchHit(hit, { now }).tender.noticeCategory).toBe('award');
  });

  it('produces no warnings for any of the four real notice types', () => {
    for (const file of Object.values(FIXTURE_FILES)) {
      const hit = doffinSearchHitSchema.parse(loadFixture(file));
      expect(normalizeSearchHit(hit, { now }).warnings, file).toEqual([]);
    }
  });
});

describe('normalizeSearchHit', () => {
  const baseHit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.competition));

  it('records the source and identifier', () => {
    const { tender } = normalizeSearchHit(baseHit, { now });
    expect(tender.source).toBe('doffin');
    expect(tender.sourceId).toBe(baseHit.id);
  });

  it('constructs the source URL, since the API supplies none', () => {
    const { tender } = normalizeSearchHit(baseHit, { now });
    expect(tender.sourceUrl).toBe(`https://www.doffin.no/notices/${baseHit.id}`);
  });

  it('leaves municipalities empty, because the API has no such field', () => {
    // Filling this from the buyer's postal city would look populated and be
    // wrong: that is where the buyer sits, not where the work happens.
    expect(normalizeSearchHit(baseHit, { now }).tender.municipalities).toEqual([]);
  });

  it('records the sync time', () => {
    expect(normalizeSearchHit(baseHit, { now }).tender.lastSyncedAt).toEqual(now);
  });

  it('keeps the whole hit as the raw payload', () => {
    const { tender } = normalizeSearchHit(baseHit, { now });
    expect(tender.rawPayload).toEqual(baseHit);
  });

  it('falls back to a Norwegian placeholder when a notice names no buyer', () => {
    const { tender } = normalizeSearchHit({ ...baseHit, buyer: [] }, { now });
    expect(tender.buyerName).toBe('Ukjent oppdragsgiver');
  });

  it('takes the first buyer when a notice has several co-purchasers', () => {
    const hit = {
      ...baseHit,
      buyer: [
        { id: 'a', name: 'Herøy kommune', organizationId: '964978840' },
        { id: 'b', name: 'Sande kommune', organizationId: '822534422' },
      ],
    };
    expect(normalizeSearchHit(hit, { now }).tender.buyerName).toBe('Herøy kommune');
  });

  it('accepts an organisation number that is not nine digits', () => {
    // Foreign buyers have identifiers of other lengths; validating as a
    // Norwegian org number would reject real notices.
    const hit = {
      ...baseHit,
      buyer: [{ id: 'x', name: 'Foreign Buyer', organizationId: 'FI-12345678901234567' }],
    };
    expect(normalizeSearchHit(hit, { now }).tender.buyerOrganizationNumber).toBe(
      'FI-12345678901234567',
    );
  });

  it('omits the deadline rather than inventing one when the API has none', () => {
    const hit = { ...baseHit, deadline: null };
    expect(normalizeSearchHit(hit, { now }).tender.deadlineAt).toBeUndefined();
  });

  it('omits both value bounds when the notice states no value', () => {
    // True for 53% of real notices, so this is the common case, not an edge.
    const hit = { ...baseHit, estimatedValue: null };
    const { tender } = normalizeSearchHit(hit, { now });
    expect(tender.estimatedValueMinNok).toBeUndefined();
    expect(tender.estimatedValueMaxNok).toBeUndefined();
  });

  it('sets both bounds to the single scalar the API supplies', () => {
    const hit = { ...baseHit, estimatedValue: { amount: 4_000_000, currencyCode: 'NOK' } };
    const { tender } = normalizeSearchHit(hit, { now });
    expect(tender.estimatedValueMinNok).toBe(4_000_000);
    expect(tender.estimatedValueMaxNok).toBe(4_000_000);
  });

  it('preserves a non-NOK currency instead of assuming kroner', () => {
    const hit = { ...baseHit, estimatedValue: { amount: 500_000, currencyCode: 'PLN' } };
    expect(normalizeSearchHit(hit, { now }).tender.currency).toBe('PLN');
  });

  it('stores the eForms UUID when the XML was fetched', () => {
    const { tender, noticeUuid } = normalizeSearchHit(baseHit, {
      now,
      noticeUuid: '9fa89bc7-d855-46a0-9c48-7bbd7e1065c9',
    });
    expect(noticeUuid).toBe('9fa89bc7-d855-46a0-9c48-7bbd7e1065c9');
    expect(tender.noticeId).toBe('9fa89bc7-d855-46a0-9c48-7bbd7e1065c9');
  });

  it('strips a CPV check digit, which would not fit the storage column', () => {
    // Every code in a 1000-notice sample was bare eight digits, but the CPV
    // standard allows `45000000-7`, which is ten characters against a
    // varchar(8) column and would fail the whole row rather than one code.
    const hit = { ...baseHit, cpvCodes: ['45000000-7', '45213316-1'] };
    expect(normalizeSearchHit(hit, { now }).tender.cpvCodes).toEqual(['45000000', '45213316']);
  });

  it('deduplicates codes that differ only by check digit', () => {
    const hit = { ...baseHit, cpvCodes: ['45000000', '45000000-7'] };
    expect(normalizeSearchHit(hit, { now }).tender.cpvCodes).toEqual(['45000000']);
  });

  it('drops a malformed CPV code with a warning rather than failing the notice', () => {
    // Losing one code costs some match precision. Failing the row loses the
    // tender entirely and holds back the ingest checkpoint.
    const { tender, warnings } = normalizeSearchHit(
      { ...baseHit, cpvCodes: ['45000000', 'NOT-A-CODE'] },
      { now },
    );
    expect(tender.cpvCodes).toEqual(['45000000']);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]?.message).toContain('NOT-A-CODE');
  });

  it('warns but still normalises an unknown notice type', () => {
    const { tender, warnings } = normalizeSearchHit({ ...baseHit, type: 'BRAND_NEW' }, { now });
    expect(tender.noticeCategory).toBe('other');
    expect(warnings).toHaveLength(1);
  });
});

describe('geography handling', () => {
  it('flags a nationwide notice and keeps the marker in regions', () => {
    const { regions, isNationwide } = partitionLocations(['anyw']);
    expect(isNationwide).toBe(true);
    expect(regions).toEqual([]);
  });

  it('keeps real NUTS codes', () => {
    const { regions, isNationwide } = partitionLocations(['NO081', 'NO0A2']);
    expect(regions).toEqual(['NO081', 'NO0A2']);
    expect(isNationwide).toBe(false);
  });

  it('handles a notice that is both nationwide and regionally tagged', () => {
    const { regions, isNationwide } = partitionLocations(['anyw', 'NO081']);
    expect(isNationwide).toBe(true);
    expect(regions).toEqual(['NO081']);
  });

  it('drops the unspecified-location NUTS code', () => {
    expect(partitionLocations(['NOZZZ']).regions).toEqual([]);
  });

  it('treats a missing location array as no regions', () => {
    expect(partitionLocations(null)).toEqual({ regions: [], isNationwide: false });
    expect(partitionLocations(undefined)).toEqual({ regions: [], isNationwide: false });
  });

  it('keeps a foreign NUTS code rather than discarding it', () => {
    expect(partitionLocations(['FI1D9']).regions).toEqual(['FI1D9']);
  });

  it('surfaces nationwide notices through the normalised regions list', () => {
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.competition));
    const { tender } = normalizeSearchHit({ ...hit, locationId: ['anyw'] }, { now });
    expect(tender.regions).toContain(NATIONWIDE_LOCATION);
  });
});

describe('parsePublicationDate', () => {
  it('reads a bare date as midnight UTC', () => {
    expect(parsePublicationDate('2026-08-03').toISOString()).toBe('2026-08-03T00:00:00.000Z');
  });

  it('is independent of the machine timezone', () => {
    // The API sends a date with no time. Interpreting it locally would make
    // the stored instant depend on where the ingest ran.
    expect(parsePublicationDate('2026-01-01').getUTCDate()).toBe(1);
    expect(parsePublicationDate('2026-01-01').getUTCHours()).toBe(0);
  });
});

describe('hashPayload', () => {
  it('is stable for the same object', () => {
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ a: 1, b: 2 }));
  });

  it('ignores key order, so a reordered response is not a false change', () => {
    // Without this, every notice would look modified on every sync run.
    expect(hashPayload({ a: 1, b: 2 })).toBe(hashPayload({ b: 2, a: 1 }));
  });

  it('ignores key order in nested objects too', () => {
    expect(hashPayload({ o: { x: 1, y: 2 } })).toBe(hashPayload({ o: { y: 2, x: 1 } }));
  });

  /**
   * This assertion used to read the other way round — `[1,2]` and `[2,1]` were
   * required to hash *differently*, on the stated grounds that array order "is
   * meaningful". Doffin does not agree, and the live API is the authority on
   * what Doffin sends. It serves the same notice with `allTypes` in a
   * different sequence between fetches minutes apart, so the old rule made 741
   * of 1015 notices in a real corpus look modified when nothing had changed,
   * and eventually stalled the ingest checkpoint entirely.
   *
   * The test was not wrong about anything it could observe. It was written
   * against fixtures, where array order is whatever the fixture author typed,
   * and no fixture can show you that a live source reorders its own responses.
   */
  it('ignores array order, because the source reorders its own arrays', () => {
    expect(hashPayload([1, 2])).toBe(hashPayload([2, 1]));
  });

  it('ignores array order for arrays of objects too', () => {
    expect(hashPayload([{ a: 1 }, { b: 2 }])).toBe(hashPayload([{ b: 2 }, { a: 1 }]));
  });

  it('still sees a genuine change to an array member', () => {
    // Order-insensitivity must not become blindness: a different multiset is
    // still a different payload.
    expect(hashPayload([1, 2])).not.toBe(hashPayload([1, 3]));
    expect(hashPayload([1, 2])).not.toBe(hashPayload([1, 2, 3]));
    // A repeated element is part of the multiset, not noise to be collapsed.
    expect(hashPayload([1, 1, 2])).not.toBe(hashPayload([1, 2]));
  });

  it('is unmoved by the exact permutation observed on notice 2026-112262', () => {
    // Captured from two live fetches minutes apart. Pinned as a regression:
    // this is the shape that stalled the ingest.
    const a = { allTypes: ['COMPETITION', 'NOTICE_ON_BUYER_PROFILE', 'ANNOUNCEMENT', 'PLANNING'] };
    const b = { allTypes: ['ANNOUNCEMENT', 'PLANNING', 'COMPETITION', 'NOTICE_ON_BUYER_PROFILE'] };
    expect(hashPayload(a)).toBe(hashPayload(b));
  });

  it('changes when a value changes', () => {
    expect(hashPayload({ a: 1 })).not.toBe(hashPayload({ a: 2 }));
  });

  it('distinguishes a null from a missing key', () => {
    expect(hashPayload({ a: null })).not.toBe(hashPayload({}));
  });
});

describe('extractWinners', () => {
  it('reads the winner from a real award notice', () => {
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.award));
    const winners = extractWinners(hit);
    expect(winners.length).toBeGreaterThan(0);
    expect(winners[0]?.name).toBeTruthy();
  });

  it('also finds a winner on an intention notice, which is not an award', () => {
    // A VEAT names the supplier the buyer intends to award to without
    // competition. Anything downstream must check the category, not this.
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.intention));
    expect(extractWinners(hit).length).toBeGreaterThan(0);
    expect(normalizeSearchHit(hit, { now }).tender.noticeCategory).toBe('planned');
  });

  it('returns nothing for a competition notice', () => {
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.competition));
    expect(extractWinners(hit)).toEqual([]);
  });

  it('collects winners across every lot', () => {
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.award));
    const many = {
      ...hit,
      lots: [
        { heading: 'Lot 1', winner: [{ name: 'A AS', organizationId: '111111111' }] },
        { heading: 'Lot 2', winner: [{ name: 'B AS', organizationId: '222222222' }] },
      ],
    };
    expect(extractWinners(many).map((w) => w.name)).toEqual(['A AS', 'B AS']);
  });

  it('handles a notice with no lots at all', () => {
    const hit = doffinSearchHitSchema.parse(loadFixture(FIXTURE_FILES.award));
    expect(extractWinners({ ...hit, lots: null })).toEqual([]);
  });
});

describe('buildSourceUrl', () => {
  it('builds the public notice URL', () => {
    expect(buildSourceUrl('2026-112541')).toBe('https://www.doffin.no/notices/2026-112541');
  });

  it('encodes an identifier that would otherwise break the path', () => {
    expect(buildSourceUrl('a/b')).toBe('https://www.doffin.no/notices/a%2Fb');
  });
});
