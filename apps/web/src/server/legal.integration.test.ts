import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { outstandingTerms } from './legal';

const describeDb = hasDatabase ? describe : describe.skip;

/**
 * Whether a user owes an acceptance (spec section 20.1).
 *
 * The question the gate asks on every request into the signed-in service. Two
 * ways of getting it wrong matter more than the rest: answering "owed" for
 * somebody who is up to date locks them out of a service they have paid
 * nothing to be locked out of, and answering "settled" for somebody who is not
 * leaves the service being used under terms nobody agreed to, which is the
 * whole reason this exists.
 */
describeDb('outstandingTerms', () => {
  let harness: TestDatabase;
  let userId: string;

  const SEEDED = '2026-01-utkast';

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness.destroy();
  });

  beforeEach(async () => {
    // Acceptances are append-only and guarded by a trigger, so each case gets
    // its own user rather than trying to undo the last one's history.
    const [user] = await harness.db
      .insert(schema.users)
      .values({ email: `bruker-${crypto.randomUUID()}@eksempel.no` })
      .returning({ id: schema.users.id });
    userId = user!.id;
  });

  it('owes the version in force when nothing has been accepted', async () => {
    const outstanding = await outstandingTerms(harness.db, userId);
    expect(outstanding?.version).toBe(SEEDED);
    // The body comes back with it, so the acceptance page renders exactly the
    // text the user is being asked to accept rather than fetching it again.
    expect(outstanding?.body).toContain('Om tjenesten');
  });

  it('owes nothing once the version in force is accepted', async () => {
    await harness.db.insert(schema.userLegalAcceptances).values({
      userId,
      kind: 'terms',
      version: SEEDED,
      acceptedAt: new Date(),
    });

    expect(await outstandingTerms(harness.db, userId)).toBeNull();
  });

  it('owes the newer version when only an older one was accepted', async () => {
    await harness.db.insert(schema.userLegalAcceptances).values({
      userId,
      kind: 'terms',
      version: SEEDED,
      acceptedAt: new Date('2026-02-01T00:00:00.000Z'),
    });

    const [document] = await harness.db
      .select({ id: schema.legalDocuments.id })
      .from(schema.legalDocuments)
      .where(eq(schema.legalDocuments.kind, 'terms'));

    await harness.db.insert(schema.legalDocumentVersions).values({
      legalDocumentId: document!.id,
      kind: 'terms',
      version: '2026-09-gjennomgatt',
      body: '## Nye vilkår\n\nGjennomgått tekst.',
      isPlaceholder: false,
      effectiveFrom: new Date('2026-09-01T00:00:00.000Z'),
    });

    const outstanding = await outstandingTerms(harness.db, userId);
    expect(outstanding?.version).toBe('2026-09-gjennomgatt');

    // And accepting the new one settles it, without the old acceptance being
    // touched -- the log is append-only and the old agreement still happened.
    await harness.db.insert(schema.userLegalAcceptances).values({
      userId,
      kind: 'terms',
      version: '2026-09-gjennomgatt',
      acceptedAt: new Date(),
    });
    expect(await outstandingTerms(harness.db, userId)).toBeNull();

    const history = await harness.db
      .select({ version: schema.userLegalAcceptances.version })
      .from(schema.userLegalAcceptances)
      .where(eq(schema.userLegalAcceptances.userId, userId));
    expect(history.map((row) => row.version).sort()).toEqual([
      '2026-01-utkast',
      '2026-09-gjennomgatt',
    ]);
  });

});

/**
 * The lockout case, in its own database.
 *
 * It needs a `legal_document_versions` with no rows, and it cannot get there
 * by deleting from the suite above: `user_legal_acceptances_version_fk` refuses
 * to drop a version somebody has accepted. That refusal is correct — an
 * acceptance names its version, and deleting the version would strand the
 * record of what a person agreed to — so this takes a clean database rather
 * than working around the constraint.
 *
 * The consequence being guarded is the worst one available: an empty table
 * must not mean every user is locked out of the service.
 */
describeDb('outstandingTerms with nothing in force', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness.destroy();
  });

  it('owes nothing, rather than blocking everybody', async () => {
    const [user] = await harness.db
      .insert(schema.users)
      .values({ email: 'ingen-vilkar@eksempel.no' })
      .returning({ id: schema.users.id });

    await harness.db.execute(sql`DELETE FROM legal_document_versions WHERE kind = 'terms'`);

    expect(await outstandingTerms(harness.db, user!.id)).toBeNull();
  });
});
