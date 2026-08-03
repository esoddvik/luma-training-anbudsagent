import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { FORBIDDEN_SHARE_FIELDS } from '@luma/domain';
import type { Database } from './db';
import { getSharedTenderView, listOwnShares, recordShareView } from './shares';
import { simplifyForSharing } from './match-explanation';
import {
  OTHER_USER_EMAIL,
  PROFILE_BUYER,
  PROFILE_EXCLUDED_KEYWORD,
  PROFILE_KEYWORD,
  PROFILE_NAME,
  SHARER_EMAIL,
  seedMatch,
  seedProfile,
  seedShare,
  seedTender,
  seedUser,
} from './testing/fixtures';

/**
 * The shared view, and above all what it must not contain.
 *
 * Spec section 17 forbids the public page from exposing who shared a tender,
 * the profile name, the profile criteria or any other personal data, and launch
 * blocker 51.11 makes verifying that a condition of release. This suite is that
 * verification.
 *
 * The method matters. Rather than asserting field by field — which only catches
 * the fields somebody remembered to think of — the payload is serialised and
 * searched for every string that *would* be a leak: the sharer's e-mail and id,
 * the profile's name, its included and excluded keywords, its buyer list, and
 * every name in `FORBIDDEN_SHARE_FIELDS`. Adding a field to `tenders` or to the
 * share query cannot slip past that unless someone also adds it to
 * `sharedTenderViewSchema`, which is a review nobody performs by accident.
 */

const describeWithDatabase = hasDatabase ? describe : describe.skip;

describeWithDatabase('delt-visningen lekker ingen persondata', () => {
  let harness: TestDatabase;
  let db: Database;

  let sharerId: string;
  let otherUserId: string;
  let tenderId: string;
  let profileId: string;
  let token: string;

  beforeAll(async () => {
    harness = await createTestDatabase();
    db = harness.db as unknown as Database;

    const sharer = await seedUser(db, SHARER_EMAIL);
    const other = await seedUser(db, OTHER_USER_EMAIL);
    sharerId = sharer.id;
    otherUserId = other.id;

    tenderId = await seedTender(db, {
      title: 'Rammeavtale for vedlikehold av kommunale bygg',
      buyerName: 'Testkommune',
      description: 'Konkurransen gjelder løpende vedlikehold.',
      cpvCodes: ['45000000', '45210000'],
      regionCodes: ['NO081'],
      estimatedValueNok: 4_000_000,
      currency: 'NOK',
    });

    profileId = await seedProfile(db, { userId: sharerId });
    await seedMatch(db, { tenderId, alertProfileId: profileId });
    token = await seedShare(db, { tenderId, createdByUserId: sharerId });
  }, 60_000);

  afterAll(async () => {
    await harness?.destroy();
  });

  it('viser anbudet med kategori, frist, kildelenke og synkroniseringstidspunkt', async () => {
    const result = await getSharedTenderView(db, { token, now: new Date() });
    expect(result.kind).toBe('ok');
    if (result.kind !== 'ok') return;

    expect(result.view.title).toBe('Rammeavtale for vedlikehold av kommunale bygg');
    expect(result.view.buyerName).toBe('Testkommune');
    expect(result.view.noticeCategory).toBe('competition');
    expect(result.view.sourceUrl).toContain('doffin.no');
    expect(result.view.lastSyncedAt).toBeInstanceOf(Date);
    expect(result.view.deadlineAt).toBeInstanceOf(Date);
  });

  it('viser begrunnelsestypene, men ingen av verdiene bak dem', async () => {
    const result = await getSharedTenderView(db, { token, now: new Date() });
    if (result.kind !== 'ok') throw new Error('forventet en gyldig delt visning');

    expect([...result.view.matchReasonTypes].sort()).toEqual(['cpv', 'keyword']);

    const simplified = simplifyForSharing(result.view.matchReasonTypes);
    expect(simplified.labels).toContain('Søkeord');
    expect(JSON.stringify(simplified)).not.toContain(PROFILE_KEYWORD);
  });

  /**
   * The test that matters.
   *
   * Every assertion below has been shown to fail: adding `createdByUserId` to
   * the payload built in `getSharedTenderView` turns this red, which is what
   * makes a green run evidence rather than decoration.
   */
  it('inneholder ingen av de forbudte feltene, ingen deler-identitet og ingen profilkriterier', async () => {
    const result = await getSharedTenderView(db, { token, now: new Date() });
    if (result.kind !== 'ok') throw new Error('forventet en gyldig delt visning');

    const payload = JSON.stringify(result.view);
    const keys = Object.keys(result.view);

    // 1. None of the field names the domain declares off-limits.
    for (const forbidden of FORBIDDEN_SHARE_FIELDS) {
      expect(keys, `feltet «${forbidden}» skal ikke finnes i den delte visningen`).not.toContain(
        forbidden,
      );
      expect(payload, `«${forbidden}» skal ikke forekomme i nyttelasten`).not.toContain(forbidden);
    }

    // 2. Nothing that identifies the person who shared it.
    expect(payload).not.toContain(SHARER_EMAIL);
    expect(payload).not.toContain(sharerId);
    expect(payload).not.toContain(otherUserId);
    expect(payload).not.toContain(profileId);

    // 3. No profile criteria: not the name, not the keywords, not the buyers.
    expect(payload).not.toContain(PROFILE_NAME);
    expect(payload).not.toContain(PROFILE_KEYWORD);
    expect(payload).not.toContain(PROFILE_EXCLUDED_KEYWORD);
    expect(payload).not.toContain(PROFILE_BUYER);

    // 4. No score, and no token to copy out of the page source.
    expect(payload).not.toContain(token);
    expect(payload).not.toMatch(/"score"/);
  });

  it('behandler et opphevet, et utløpt og et ukjent token likt utad', async () => {
    const revoked = await seedShare(db, {
      tenderId,
      createdByUserId: sharerId,
      revokedAt: new Date(),
    });
    const expired = await seedShare(db, {
      tenderId,
      createdByUserId: sharerId,
      expiresAt: new Date(Date.now() - 86_400_000),
    });

    const results = await Promise.all([
      getSharedTenderView(db, { token: revoked, now: new Date() }),
      getSharedTenderView(db, { token: expired, now: new Date() }),
      getSharedTenderView(db, { token: 'z'.repeat(43), now: new Date() }),
    ]);

    // Alle tre gir «unavailable». Årsaken finnes for logging, men siden viser
    // samme nøytrale tekst, slik at et gjettet token ikke kan bekreftes.
    for (const result of results) expect(result.kind).toBe('unavailable');
  });

  it('avviser et for kort token uten å slå opp i databasen', async () => {
    const result = await getSharedTenderView(db, { token: 'kort', now: new Date() });
    expect(result).toEqual({ kind: 'unavailable', reason: 'not_found' });
  });

  it('viser ikke et anbud administrator har undertrykt', async () => {
    const suppressedTender = await seedTender(db, { suppressed: true });
    const suppressedToken = await seedShare(db, {
      tenderId: suppressedTender,
      createdByUserId: sharerId,
    });

    const result = await getSharedTenderView(db, { token: suppressedToken, now: new Date() });
    expect(result.kind).toBe('unavailable');
  });

  it('teller visninger, men bare for et token som finnes', async () => {
    const before = await listOwnShares(db, sharerId);
    const beforeCount = before.find((share) => share.token === token)?.viewCount ?? -1;

    await recordShareView(db, token);

    const after = await listOwnShares(db, sharerId);
    const afterCount = after.find((share) => share.token === token)?.viewCount ?? -1;
    expect(afterCount).toBe(beforeCount + 1);
  });

  it('lar en bruker bare se sine egne delingslenker', async () => {
    const mine = await listOwnShares(db, sharerId);
    const theirs = await listOwnShares(db, otherUserId);

    expect(mine.length).toBeGreaterThan(0);
    expect(theirs).toHaveLength(0);
  });
});
