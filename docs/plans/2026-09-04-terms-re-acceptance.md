# Terms Re-Acceptance Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A user whose accepted terms version is no longer the one in force is blocked from the service until they accept the current version, and a new version can actually be published.

**Architecture:** Terms text becomes committed content in `@luma/content`, reconciled into `legal_document_versions` by an insert-only sync with an admin page and a `CRON_SECRET`-signed route. The "is an acceptance outstanding" decision is a pure function in `@luma/domain` used by both `apps/core` and `apps/web`. The gate lives in `(app)/layout.tsx` and again in write actions; routes that must stay reachable move to a sibling route group `(konto)` because a Next.js layout cannot see the pathname.

**Tech Stack:** Next.js App Router (server components, server actions), Drizzle ORM, PostgreSQL 16, Vitest, Zod, pnpm workspaces + Turbo.

**Design:** `docs/specs/2026-09-04-terms-re-acceptance-design.md`

---

## Phases

**Phase A (Tasks 1–5) — publishing.** Independently shippable and valuable on its own: it fixes the fact that signup does not work on a clean deploy, because `legal_document_versions` is never populated.

**Phase B (Tasks 6–12) — the gate.** Depends on Phase A only in that the gate cannot be demonstrated without a way to publish a second version.

Each phase ends green: `pnpm typecheck && pnpm lint && pnpm test` passes.

## Running the gates

The suite skips every integration test when `DATABASE_URL` is unset, and reports success having verified nothing. Before starting:

```bash
docker compose up -d && pnpm db:migrate
```

Every `Run:` step below assumes `DATABASE_URL` is exported from `.env`. Turbo's cache is shared with the worktrees under `.claude/worktrees/`, so a green that must mean something about *this* tree needs `--force`.

## File structure

| File | Responsibility |
| --- | --- |
| `packages/domain/src/consent.ts` | + `isAcceptanceOutstanding` — the pure decision, one copy |
| `packages/content/src/legal-documents.ts` | The terms document as committed content |
| `packages/content/src/index.ts` | Re-export |
| `packages/db/drizzle/0008_seed_placeholder_terms.sql` | Seeds the placeholder so a clean deploy can sign up |
| `apps/web/src/server/legal-documents.ts` | Insert-only reconciliation: compute, load, apply |
| `apps/web/src/server/legal.ts` | `recordTermsAcceptance` (moved here) + `outstandingTerms` |
| `apps/web/src/server/actions/legal-actions.ts` | `acceptTermsAction`, `syncLegalDocumentsAction` |
| `apps/web/src/server/actions/session-actions.ts` | `signOutAction` |
| `apps/web/src/server/session.ts` | + `requireCurrentTerms` |
| `apps/web/app/(konto)/layout.tsx` | Auth without the terms gate |
| `apps/web/app/(konto)/vilkar/godta/page.tsx` | The re-acceptance page |
| `apps/web/app/(konto)/innstillinger/slett-konto/page.tsx` | Moved from `(app)` |
| `apps/web/app/(admin)/admin/vilkar/page.tsx` | The diff and the button |
| `apps/web/app/(public)/synk-vilkar/route.ts` | The machine path |

---

# Phase A — publishing

## Task 1: The outstanding decision, in one place

`apps/core`'s `getLegalStatus` computes this inline. `apps/web` is about to need the same answer, and a second copy is how two runtimes start disagreeing about a fact with legal weight.

**Files:**
- Modify: `packages/domain/src/consent.ts`
- Test: `packages/domain/src/legal-acceptance.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/domain/src/legal-acceptance.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { isAcceptanceOutstanding } from './consent.js';

/**
 * Whether a user owes an acceptance (spec §20.1, ADR-11).
 *
 * Extracted from `apps/core`'s `getLegalStatus` so `apps/web`'s gate cannot
 * answer this question differently from the API that reports it.
 */
describe('isAcceptanceOutstanding', () => {
  it('is outstanding when the accepted version is not the one in force', () => {
    expect(isAcceptanceOutstanding('2026-03', '2026-01-utkast')).toBe(true);
  });

  it('is settled when they match', () => {
    expect(isAcceptanceOutstanding('2026-03', '2026-03')).toBe(false);
  });

  it('is outstanding when nothing has been accepted', () => {
    expect(isAcceptanceOutstanding('2026-03', null)).toBe(true);
  });

  // The service must not lock everyone out because the table is empty. There
  // is nothing to accept, so nothing is owed.
  it('is not outstanding when no version is in force', () => {
    expect(isAcceptanceOutstanding(null, null)).toBe(false);
    expect(isAcceptanceOutstanding(null, '2026-01-utkast')).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @luma/domain test -- legal-acceptance`
Expected: FAIL — `isAcceptanceOutstanding is not a function` / import error.

- [ ] **Step 3: Implement**

Append to `packages/domain/src/consent.ts`:

```ts
/**
 * Whether the user owes an acceptance of the version now in force (§20.1).
 *
 * One copy, imported by `apps/core`'s `getLegalStatus` and by `apps/web`'s
 * gate. Two runtimes deciding this separately would eventually disagree about
 * a fact with legal weight, which is the same argument `machine-signature.ts`
 * makes about being written twice.
 *
 * A null `currentVersion` is **not** outstanding. No version in force means
 * there is nothing to accept, and treating it as owed would block every user
 * the moment `legal_document_versions` was empty — which is its state on a
 * fresh database.
 */
export function isAcceptanceOutstanding(
  currentVersion: string | null,
  acceptedVersion: string | null,
): boolean {
  if (currentVersion === null) return false;
  return acceptedVersion !== currentVersion;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `pnpm --filter @luma/domain test -- legal-acceptance`
Expected: PASS, 5 assertions.

- [ ] **Step 5: Re-point core at it**

In `apps/core/src/services/legal.ts`, add `isAcceptanceOutstanding` to the existing `@luma/domain` import and replace the inline expression:

```ts
        outstanding: isAcceptanceOutstanding(current?.version ?? null, mine?.version ?? null),
```

- [ ] **Step 6: Confirm core's existing tests still pass**

Run: `npx turbo run test --force --filter=core`
Expected: PASS, 250 tests. These are the guard for the refactor — no new test needed here.

- [ ] **Step 7: Commit**

```bash
git commit -m "Give one answer to whether an acceptance is outstanding" -- packages/domain/src/consent.ts packages/domain/src/legal-acceptance.test.ts apps/core/src/services/legal.ts
```

---

## Task 2: The terms document as committed content

**Files:**
- Create: `packages/content/src/legal-documents.ts`
- Modify: `packages/content/src/index.ts`
- Test: `packages/content/src/legal-documents.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/content/src/legal-documents.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { LEGAL_DOCUMENT_SEEDS, legalDocumentSeedSchema } from './legal-documents.js';

describe('legal document seeds', () => {
  it('every seed satisfies its schema', () => {
    for (const seed of LEGAL_DOCUMENT_SEEDS) {
      expect(() => legalDocumentSeedSchema.parse(seed)).not.toThrow();
    }
  });

  it('has exactly one terms version and it is the placeholder', () => {
    const terms = LEGAL_DOCUMENT_SEEDS.filter((seed) => seed.kind === 'terms');
    expect(terms).toHaveLength(1);
    expect(terms[0]!.isPlaceholder).toBe(true);
  });

  // Spec §6: all customer-facing text is Norwegian bokmål. A body written in
  // English would reach a legal page, which is the worst place for it.
  it('is written in Norwegian', () => {
    for (const seed of LEGAL_DOCUMENT_SEEDS) {
      expect(seed.body).toMatch(/[æøå]/i);
    }
  });

  it('carries no two seeds with the same kind and version', () => {
    const keys = LEGAL_DOCUMENT_SEEDS.map((seed) => `${seed.kind}:${seed.version}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter @luma/content test -- legal-documents`
Expected: FAIL — cannot resolve `./legal-documents.js`.

- [ ] **Step 3: Implement the content module**

Create `packages/content/src/legal-documents.ts`. Move the prose currently hardcoded in `apps/web/app/(public)/vilkar/page.tsx` into `body` as Markdown, keeping the same headings and the same version string `2026-01-utkast`:

```ts
import { legalDocumentKindSchema } from '@luma/domain';
import { z } from 'zod';

/**
 * Legal documents as committed content (spec §19, ADR-11).
 *
 * ## Why the text lives here rather than in the page
 *
 * `/vilkar` used to render this prose inline and stamp a `TERMS_VERSION`
 * constant from `apps/web/src/lib/legal.ts`, while `legal_document_versions`
 * held a separate row that nothing kept in step. A user could accept version X
 * while reading the text of version Y and nothing would detect it. One source
 * now: this file is rendered by the page, seeded into the table, and copied
 * into `consent_text_versions` when somebody accepts.
 *
 * ## What engineering may and may not do with this file
 *
 * §19 says the final terms are not published without review, and
 * `launch-readiness.md` blocker 2 says engineering must not write them. The
 * *mechanism* is engineering's; the *text* is Luma's. `isPlaceholder` is how
 * the difference is carried: it stays `true` until Luma supplies reviewed text
 * under a new version, and §51 item 8 blocks launch while any document in
 * force is a placeholder.
 *
 * ## Versions are append-only
 *
 * Publishing new terms means **adding** an entry, never editing one. An
 * acceptance carries a foreign key onto `(kind, version)`, so editing a
 * published body rewrites what people already agreed to. The sync refuses it —
 * see `apps/web/src/server/legal-documents.ts`.
 */

export const legalDocumentSeedSchema = z.object({
  kind: legalDocumentKindSchema,
  /** Sorts as a date-ish string; the newest `effectiveFrom` is what is in force. */
  version: z.string().min(1),
  /** Norwegian bokmål. Markdown. */
  body: z.string().min(1),
  /** True while the text is a draft rather than reviewed legal copy. */
  isPlaceholder: z.boolean(),
  effectiveFrom: z.date(),
});

export type LegalDocumentSeed = z.infer<typeof legalDocumentSeedSchema>;

const TERMS_PLACEHOLDER_BODY = `## Om tjenesten

Luma Anbudsvarsling er en gratis tjeneste fra Luma Training som varsler om
kunngjøringer og planlagte anskaffelser publisert på Doffin. Tjenesten er et
hjelpemiddel i tilbudsarbeidet, ikke en erstatning for oppdragsgivers egne
kanaler.

## Ditt ansvar

Du er selv ansvarlig for å følge fristene og kravene i den enkelte
konkurransen. Luma Training svarer ikke for tapte muligheter, forsinkede
varsler eller feil i data hentet fra Doffin.

## Rangering og markedsføring

Kommersielle hensyn påvirker aldri hvilke anbud som rangeres høyest.

## Personopplysninger

Behandling av personopplysninger er beskrevet i Luma Trainings
personvernerklæring. Du kan slette kontoen din når som helst.

Dette er et utkast. Endelige vilkår godkjennes og versjonslagres før tjenesten
åpnes for publikum.`;

export const LEGAL_DOCUMENT_SEEDS: readonly LegalDocumentSeed[] = [
  {
    kind: 'terms',
    version: '2026-01-utkast',
    body: TERMS_PLACEHOLDER_BODY,
    isPlaceholder: true,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  },
] as const;

/** The document of a kind that is in force: the latest `effectiveFrom`. */
export function currentLegalDocumentSeed(
  kind: LegalDocumentSeed['kind'],
  seeds: readonly LegalDocumentSeed[] = LEGAL_DOCUMENT_SEEDS,
): LegalDocumentSeed | undefined {
  return seeds
    .filter((seed) => seed.kind === kind)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}
```

- [ ] **Step 4: Export it**

Append to `packages/content/src/index.ts`:

```ts
export {
  currentLegalDocumentSeed,
  legalDocumentSeedSchema,
  LEGAL_DOCUMENT_SEEDS,
  type LegalDocumentSeed,
} from './legal-documents.js';
```

- [ ] **Step 5: Run it and watch it pass**

Run: `pnpm --filter @luma/content test -- legal-documents`
Expected: PASS, 4 tests.

- [ ] **Step 6: Commit**

```bash
git commit -m "Put the terms text where one thing owns it" -- packages/content/src/legal-documents.ts packages/content/src/legal-documents.test.ts packages/content/src/index.ts
```

---

## Task 3: Seed the placeholder so a clean deploy can sign up

`legal_document_versions` is created in `0000_initial_schema.sql` and never populated. `confirmSignup` returns `no_terms` when it is empty, so registration is impossible on a fresh database.

**Files:**
- Create: `packages/db/drizzle/0008_seed_placeholder_terms.sql`
- Test: `packages/db/src/legal-seed.integration.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `packages/db/src/legal-seed.integration.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { LEGAL_DOCUMENT_SEEDS } from '@luma/content';
import * as schema from './schema/index.js';
import { createTestDatabase, hasDatabase } from './testing/harness.js';

const describeDb = hasDatabase ? describe : describe.skip;

/**
 * The migration seeds a terms version (spec §19, §51 blocker 2).
 *
 * Without a row here `confirmSignup` returns `no_terms` and nobody can
 * register at all, which was the state of every clean deploy until this
 * migration existed.
 */
describeDb('placeholder terms seed', () => {
  it('leaves a terms version in force on a fresh database', async () => {
    const harness = await createTestDatabase();
    try {
      const rows = await harness.db
        .select()
        .from(schema.legalDocumentVersions)
        .where(eq(schema.legalDocumentVersions.kind, 'terms'));

      expect(rows).toHaveLength(1);
      expect(rows[0]!.isPlaceholder).toBe(true);
    } finally {
      await harness.destroy();
    }
  });

  // Two hand-maintained copies of a version string is the two-sources-of-truth
  // problem this work exists to remove, reappearing between a migration and a
  // content module.
  it('seeds the same version the content module calls current', async () => {
    const harness = await createTestDatabase();
    try {
      const [row] = await harness.db
        .select()
        .from(schema.legalDocumentVersions)
        .where(eq(schema.legalDocumentVersions.kind, 'terms'));

      const seed = LEGAL_DOCUMENT_SEEDS.find((candidate) => candidate.kind === 'terms');
      expect(row!.version).toBe(seed!.version);
      expect(row!.body).toBe(seed!.body);
    } finally {
      await harness.destroy();
    }
  });
});
```

Note: check `createTestDatabase`'s returned handle for the teardown method name and use whatever `packages/db/src/testing/harness.ts` actually exposes; the surrounding suites in that directory show the convention.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx turbo run test --force --filter=@luma/db`
Expected: FAIL — `expected [] to have length 1`.

- [ ] **Step 3: Write the migration**

Create `packages/db/drizzle/0008_seed_placeholder_terms.sql`. Paste the body from Task 2 verbatim between the dollar-quotes:

```sql
-- Seeds the placeholder terms so a fresh database can accept a signup.
--
-- `legal_document_versions` has been created since 0000 and never populated,
-- so `confirmSignup` returned `no_terms` on every clean deploy and nobody
-- could register. The row is a historical fact and is frozen here; later
-- versions arrive through the sync in apps/web, never by editing this file.
--
-- ON CONFLICT DO NOTHING because an environment that already ran the sync
-- must not have its row rewritten -- acceptances point at (kind, version).

-- `title` is NOT NULL and Norwegian (spec section 6); `current_version` is
-- left alone deliberately -- see the note on it in the plan's self-review.
INSERT INTO legal_documents (id, kind, title, created_at, updated_at)
VALUES (gen_random_uuid(), 'terms', 'Vilkår for bruk', now(), now())
ON CONFLICT (kind) DO NOTHING;

INSERT INTO legal_document_versions (
  id, legal_document_id, kind, version, body, is_placeholder, effective_from, created_at
)
SELECT
  gen_random_uuid(),
  d.id,
  'terms',
  '2026-01-utkast',
  $body$## Om tjenesten

Luma Anbudsvarsling er en gratis tjeneste fra Luma Training som varsler om
kunngjøringer og planlagte anskaffelser publisert på Doffin. Tjenesten er et
hjelpemiddel i tilbudsarbeidet, ikke en erstatning for oppdragsgivers egne
kanaler.

## Ditt ansvar

Du er selv ansvarlig for å følge fristene og kravene i den enkelte
konkurransen. Luma Training svarer ikke for tapte muligheter, forsinkede
varsler eller feil i data hentet fra Doffin.

## Rangering og markedsføring

Kommersielle hensyn påvirker aldri hvilke anbud som rangeres høyest.

## Personopplysninger

Behandling av personopplysninger er beskrevet i Luma Trainings
personvernerklæring. Du kan slette kontoen din når som helst.

Dette er et utkast. Endelige vilkår godkjennes og versjonslagres før tjenesten
åpnes for publikum.$body$,
  true,
  timestamptz '2026-01-01 00:00:00+00',
  now()
FROM legal_documents d
WHERE d.kind = 'terms'
ON CONFLICT (kind, version) DO NOTHING;
```

The constraint names above are verified against `packages/db/src/schema/consent.ts`: `legal_documents` has a unique index on `kind` (`legal_documents_kind_key`) and the versions table a unique constraint on `(kind, version)` (`legal_document_versions_kind_version_key`). Still read `0000_initial_schema.sql` to confirm the emitted SQL matches the schema module before running it.

- [ ] **Step 4: Apply and run**

```bash
pnpm db:migrate
```

Run: `npx turbo run test --force --filter=@luma/db`
Expected: PASS, 70 tests.

- [ ] **Step 5: Verify a clean deploy can now sign up**

Run: `npx turbo run test --force --filter=web`
Expected: PASS. The registration suite's `refuses to create an account when no terms version is in force` must still pass — it seeds its own state, so it should be unaffected. If it fails, the migration is leaking into a suite that expected an empty table, and the test needs to delete the seeded row explicitly rather than assume emptiness.

- [ ] **Step 6: Commit**

```bash
git commit -m "Seed the terms version that made signup impossible without it" -- packages/db/drizzle/0008_seed_placeholder_terms.sql packages/db/src/legal-seed.integration.test.ts
```

---

## Task 4: The insert-only reconciliation

Mirrors `admin-service-templates.ts`, with one inversion: it never updates and never deletes.

**Files:**
- Create: `apps/web/src/server/legal-documents.ts`
- Test: `apps/web/src/server/legal-documents.test.ts` (pure), `apps/web/src/server/legal-documents.integration.test.ts`

- [ ] **Step 1: Write the failing pure test**

Create `apps/web/src/server/legal-documents.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { LegalDocumentSeed } from '@luma/content';
import { computeLegalDocumentDrift, type LegalVersionRowish } from './legal-documents';

const seed = (over: Partial<LegalDocumentSeed> = {}): LegalDocumentSeed => ({
  kind: 'terms',
  version: '2026-03',
  body: 'Vilkår for tjenesten.',
  isPlaceholder: false,
  effectiveFrom: new Date('2026-03-01T00:00:00.000Z'),
  ...over,
});

const row = (over: Partial<LegalVersionRowish> = {}): LegalVersionRowish => ({
  kind: 'terms',
  version: '2026-03',
  body: 'Vilkår for tjenesten.',
  ...over,
});

describe('computeLegalDocumentDrift', () => {
  it('reports a seed with no row as insertable', () => {
    const report = computeLegalDocumentDrift([], [seed()]);
    expect(report.insertable.map((s) => s.version)).toEqual(['2026-03']);
    expect(report.conflicts).toEqual([]);
  });

  it('reports nothing when the row already matches', () => {
    const report = computeLegalDocumentDrift([row()], [seed()]);
    expect(report.insertable).toEqual([]);
    expect(report.conflicts).toEqual([]);
  });

  /**
   * The case this file exists for. An acceptance carries a foreign key onto
   * (kind, version); rewriting a published body would change what people
   * already agreed to, so a differing body is a conflict to be reported, never
   * an update to be applied.
   */
  it('reports an edited published body as a conflict, not an update', () => {
    const report = computeLegalDocumentDrift([row({ body: 'Gammel tekst.' })], [seed()]);
    expect(report.insertable).toEqual([]);
    expect(report.conflicts).toEqual([{ kind: 'terms', version: '2026-03' }]);
  });

  it('reports a row with no seed without proposing a deletion', () => {
    const report = computeLegalDocumentDrift([row({ version: '2025-09' })], [seed()]);
    expect(report.unseeded).toEqual([{ kind: 'terms', version: '2025-09' }]);
    expect(report.insertable.map((s) => s.version)).toEqual(['2026-03']);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `pnpm --filter web test -- legal-documents`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `apps/web/src/server/legal-documents.ts`:

```ts
import { and, eq } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { LEGAL_DOCUMENT_SEEDS, type LegalDocumentSeed } from '@luma/content';
import { getWebDb, type Database } from './db';

/**
 * Reconciling `legal_document_versions` with the committed content (§19, ADR-11).
 *
 * The sibling of `admin-service-templates.ts`, and deliberately weaker than it
 * in the one way that matters. That file *updates* drifted rows, because a
 * service template is editorial content nobody has agreed to. This one must
 * never update and never delete: `user_legal_acceptances` carries a composite
 * foreign key onto `(kind, version)`, so rewriting a published body changes
 * what people already agreed to, which is the exact thing ADR-11 exists to
 * prevent.
 *
 * So the three outcomes are:
 *
 * - a seed with no row -> **inserted**;
 * - a row whose body differs from its seed -> **conflict**, reported and
 *   refused, because it means somebody edited published legal text in place;
 * - a row with no seed -> **reported**, never deleted. An older version whose
 *   text was retired still has acceptances pointing at it.
 */

/** The subset of a version row the comparison needs. */
export interface LegalVersionRowish {
  readonly kind: string;
  readonly version: string;
  readonly body: string;
}

export interface LegalDocumentRef {
  readonly kind: string;
  readonly version: string;
}

export interface LegalDocumentDriftReport {
  /** Seeds with no row. These are what `apply` writes. */
  readonly insertable: readonly LegalDocumentSeed[];
  /** Published versions whose body no longer matches the seed. Never written. */
  readonly conflicts: readonly LegalDocumentRef[];
  /** Rows with no seed. Never removed. */
  readonly unseeded: readonly LegalDocumentRef[];
}

const key = (ref: LegalDocumentRef): string => `${ref.kind}:${ref.version}`;

/** Pure: no database, no clock, no environment. */
export function computeLegalDocumentDrift(
  rows: readonly LegalVersionRowish[],
  seeds: readonly LegalDocumentSeed[] = LEGAL_DOCUMENT_SEEDS,
): LegalDocumentDriftReport {
  const byKey = new Map(rows.map((row) => [key(row), row]));
  const seedKeys = new Set(seeds.map((seed) => key(seed)));

  const insertable: LegalDocumentSeed[] = [];
  const conflicts: LegalDocumentRef[] = [];

  for (const seed of seeds) {
    const row = byKey.get(key(seed));
    if (!row) {
      insertable.push(seed);
      continue;
    }
    if (row.body !== seed.body) conflicts.push({ kind: seed.kind, version: seed.version });
  }

  return {
    insertable,
    conflicts,
    unseeded: rows
      .filter((row) => !seedKeys.has(key(row)))
      .map((row) => ({ kind: row.kind, version: row.version })),
  };
}

export async function loadLegalDocumentDrift(
  db: Database = getWebDb(),
): Promise<LegalDocumentDriftReport> {
  const rows = await db
    .select({
      kind: schema.legalDocumentVersions.kind,
      version: schema.legalDocumentVersions.version,
      body: schema.legalDocumentVersions.body,
    })
    .from(schema.legalDocumentVersions);
  return computeLegalDocumentDrift(rows);
}

/**
 * Inserts the missing versions and returns the report it acted on.
 *
 * Recomputed rather than taking a report from the caller: a page that rendered
 * a diff may have been open for an hour, and acting on a stale one would write
 * something nobody looked at.
 */
export async function applyLegalDocumentDrift(
  db: Database = getWebDb(),
): Promise<LegalDocumentDriftReport> {
  const report = await loadLegalDocumentDrift(db);

  for (const seed of report.insertable) {
    const [document] = await db
      .select({ id: schema.legalDocuments.id })
      .from(schema.legalDocuments)
      .where(eq(schema.legalDocuments.kind, seed.kind))
      .limit(1);

    // The parent row is a foreign-key target. It is created rather than
    // reported missing because, unlike a service template, nothing points at
    // it yet -- the version being inserted is its first child.
    const documentId =
      document?.id ??
      (
        await db
          .insert(schema.legalDocuments)
          // `title` is NOT NULL. Norwegian, per spec section 6.
          .values({
            kind: seed.kind,
            title: seed.kind === 'terms' ? 'Vilkår for bruk' : 'Personvernerklæring',
            createdAt: new Date(),
          })
          .returning({ id: schema.legalDocuments.id })
      )[0]!.id;

    await db
      .insert(schema.legalDocumentVersions)
      .values({
        legalDocumentId: documentId,
        kind: seed.kind,
        version: seed.version,
        body: seed.body,
        isPlaceholder: seed.isPlaceholder,
        effectiveFrom: seed.effectiveFrom,
        createdAt: new Date(),
      })
      .onConflictDoNothing({
        target: [schema.legalDocumentVersions.kind, schema.legalDocumentVersions.version],
      });
  }

  return report;
}
```

Column names are verified against `packages/db/src/schema/consent.ts`. Note `legalDocuments.title` is `NOT NULL`, which is why the insert above supplies one.

- [ ] **Step 4: Run the pure test**

Run: `pnpm --filter web test -- legal-documents.test`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the integration test**

Create `apps/web/src/server/legal-documents.integration.test.ts` asserting against a real database that: applying inserts a missing version; applying twice inserts nothing the second time; a row whose body was edited in place is reported as a conflict and its stored body is unchanged after apply.

```ts
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import { createTestDatabase, hasDatabase, type TestDatabase } from '@luma/db/testing';
import { applyLegalDocumentDrift, loadLegalDocumentDrift } from './legal-documents';

const describeDb = hasDatabase ? describe : describe.skip;

describeDb('legal document sync', () => {
  let harness: TestDatabase;

  beforeAll(async () => {
    harness = await createTestDatabase();
  });

  afterAll(async () => {
    await harness.destroy();
  });

  it('is a no-op once the seeded version is already in the table', async () => {
    const first = await applyLegalDocumentDrift(harness.db);
    const second = await applyLegalDocumentDrift(harness.db);
    expect(second.insertable).toEqual([]);
    expect(first.conflicts).toEqual([]);

    const rows = await harness.db
      .select()
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.kind, 'terms'));
    expect(rows).toHaveLength(1);
  });

  it('refuses to rewrite a published body that was edited in place', async () => {
    await harness.db
      .update(schema.legalDocumentVersions)
      .set({ body: 'Noen har endret denne teksten direkte i databasen.' })
      .where(eq(schema.legalDocumentVersions.kind, 'terms'));

    const report = await applyLegalDocumentDrift(harness.db);
    expect(report.conflicts).toHaveLength(1);

    const [row] = await harness.db
      .select({ body: schema.legalDocumentVersions.body })
      .from(schema.legalDocumentVersions)
      .where(eq(schema.legalDocumentVersions.kind, 'terms'));
    expect(row!.body).toBe('Noen har endret denne teksten direkte i databasen.');
  });
});
```

- [ ] **Step 6: Run it**

Run: `npx turbo run test --force --filter=web`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git commit -m "Reconcile the terms table without ever rewriting a published version" -- apps/web/src/server/legal-documents.ts apps/web/src/server/legal-documents.test.ts apps/web/src/server/legal-documents.integration.test.ts
```

---

## Task 5: The admin page, the action and the machine route

**Files:**
- Create: `apps/web/app/(admin)/admin/vilkar/page.tsx`, `apps/web/app/(public)/synk-vilkar/route.ts`
- Modify: `apps/web/src/server/actions/legal-actions.ts` (create), `apps/web/src/server/actions/messages.ts`, `apps/web/app/(public)/vilkar/page.tsx`

- [ ] **Step 1: Add the action messages**

In `apps/web/src/server/actions/messages.ts`, add to `ACTION_MESSAGES_NB`:

```ts
  'vilkar-publisert': {
    tone: 'success',
    text: 'Nye vilkårsversjoner er publisert.',
  },
  'vilkar-uendret': {
    tone: 'success',
    text: 'Ingen nye vilkårsversjoner å publisere.',
  },
  'vilkar-konflikt': {
    tone: 'error',
    text: 'En publisert vilkårsversjon er endret direkte i databasen. Den blir ikke overskrevet. Publiser en ny versjon i stedet.',
  },
```

- [ ] **Step 2: Write the action**

Create `apps/web/src/server/actions/legal-actions.ts`:

```ts
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { applyLegalDocumentDrift } from '../legal-documents';
import { requireAdmin } from '../session';
import { withMessage } from './messages';

/**
 * Publishing committed terms versions into `legal_document_versions` (§19).
 *
 * `requireAdmin` calls `notFound()` rather than returning, so a non-admin gets
 * a 404 and never learns the route exists.
 */
export async function syncLegalDocumentsAction(): Promise<void> {
  await requireAdmin();

  const report = await applyLegalDocumentDrift();

  revalidatePath('/admin/vilkar');
  revalidatePath('/vilkar');

  // A conflict outranks a successful insert in the message, because it means
  // published legal text was edited in place and somebody has to go and look.
  const code =
    report.conflicts.length > 0
      ? 'vilkar-konflikt'
      : report.insertable.length > 0
        ? 'vilkar-publisert'
        : 'vilkar-uendret';

  redirect(withMessage('/admin/vilkar', code));
}
```

- [ ] **Step 3: Write the admin page**

Create `apps/web/app/(admin)/admin/vilkar/page.tsx`, modelled on `admin/tjenestemaler/page.tsx`: render what would be inserted, render conflicts as an error `Alert`, render unseeded rows as information, and show the button only when `insertable.length > 0`. The diff comes before the button, always — see that file's note on why.

- [ ] **Step 4: Write the machine route**

Create `apps/web/app/(public)/synk-vilkar/route.ts`, copying the signature handling from `synk-tjenestemaler/route.ts` verbatim, including the header name. Document the blast radius the way that file does, and state plainly that this route can only insert versions already committed to `packages/content`, and can never rewrite or remove one.

- [ ] **Step 5: Re-point `/vilkar` at the content module**

Modify `apps/web/app/(public)/vilkar/page.tsx` to render `currentLegalDocumentSeed('terms')`'s body rather than hardcoded prose, and delete `TERMS_VERSION` from `apps/web/src/lib/legal.ts`. The coverage `Alert` (§43, §51 item 3) stays — it is required on the page independently of the terms body.

- [ ] **Step 6: Run the gates**

Run: `npx turbo run typecheck lint test --force`
Expected: PASS. Grep for remaining `TERMS_VERSION` importers and fix them; the registration integration test declares its own local constant and is unaffected.

- [ ] **Step 7: Commit**

```bash
git commit -m "Give an operator a way to publish terms, and one text to publish"
```

**Phase A is complete here.** A clean deploy can sign up, `/vilkar` and the table agree, and a new version can be published by a human or a machine.

---

# Phase B — the gate

## Task 6: Move `recordTermsAcceptance` out of registration

A pure move, guarded by the existing registration suite. No behaviour change.

**Files:**
- Create: `apps/web/src/server/legal.ts`
- Modify: `apps/web/src/server/registration.ts`

- [ ] **Step 1: Move the function**

Cut `recordTermsAcceptance` (and its `Tx` type import) from `registration.ts` into a new `apps/web/src/server/legal.ts`, exporting it. Keep the doc comment intact — it carries the §20.1 argument about not merging obligatory acceptance with marketing consent.

Add a `source` parameter, defaulting to `'signup'`, so the re-acceptance path can record its own source without a second copy of the function:

```ts
export async function recordTermsAcceptance(
  tx: Tx,
  input: {
    userId: string;
    version: string;
    body: string;
    effectiveFrom: Date;
    now: Date;
    ipAddressHash: string | null;
    userAgent: string | null;
    /** ADR-9 rule 4: every consent event names where it came from. */
    source?: 'signup' | 'settings';
  },
): Promise<void> {
```

and use `input.source ?? 'signup'` where the literal `'signup'` appears in the `consentEvents` insert.

- [ ] **Step 2: Import it back into registration**

```ts
import { recordTermsAcceptance } from './legal';
```

- [ ] **Step 3: Run the guard**

Run: `npx turbo run test --force --filter=web`
Expected: PASS, 285 tests. The registration suite is the proof this move changed nothing.

- [ ] **Step 4: Commit**

```bash
git commit -m "Move terms acceptance where two callers can reach it" -- apps/web/src/server/legal.ts apps/web/src/server/registration.ts
```

---

## Task 7: Detect an outstanding acceptance

**Files:**
- Modify: `apps/web/src/server/legal.ts`
- Test: `apps/web/src/server/legal.integration.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/server/legal.integration.test.ts` covering: a user who accepted the version in force is not outstanding; a user who accepted an older version is; a user with no acceptance is; and when the table holds no terms version at all, nobody is outstanding. Seed a second version with a later `effectiveFrom` to make the "older version" case real.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx turbo run test --force --filter=web`
Expected: FAIL — `outstandingTerms is not a function`.

- [ ] **Step 3: Implement**

Append to `apps/web/src/server/legal.ts`:

```ts
/**
 * The terms version in force and whether this user still owes it (§20.1).
 *
 * Returns the body too, so the acceptance page can render exactly the text the
 * user is being asked to accept rather than fetching it a second time and
 * risking a different answer.
 */
export async function outstandingTerms(
  db: Database,
  userId: string,
): Promise<{ version: string; body: string; effectiveFrom: Date } | null> {
  const [current] = await db
    .select({
      version: schema.legalDocumentVersions.version,
      body: schema.legalDocumentVersions.body,
      effectiveFrom: schema.legalDocumentVersions.effectiveFrom,
    })
    .from(schema.legalDocumentVersions)
    .where(eq(schema.legalDocumentVersions.kind, 'terms'))
    .orderBy(desc(schema.legalDocumentVersions.effectiveFrom))
    .limit(1);

  const [accepted] = await db
    .select({ version: schema.userLegalAcceptances.version })
    .from(schema.userLegalAcceptances)
    .where(
      and(
        eq(schema.userLegalAcceptances.userId, userId),
        eq(schema.userLegalAcceptances.kind, 'terms'),
      ),
    )
    .orderBy(desc(schema.userLegalAcceptances.acceptedAt))
    .limit(1);

  if (!isAcceptanceOutstanding(current?.version ?? null, accepted?.version ?? null)) return null;
  // `current` is non-null whenever the decision says outstanding.
  return current!;
}
```

- [ ] **Step 4: Run and commit**

Run: `npx turbo run test --force --filter=web`

```bash
git commit -m "Ask whether this user owes an acceptance" -- apps/web/src/server/legal.ts apps/web/src/server/legal.integration.test.ts
```

---

## Task 8: Sign-out

There is none today. `databaseSessionStore` exposes `revoke()` and nothing calls it, so under a hard block deleting the account would be a user's only exit.

**Files:**
- Create: `apps/web/src/server/actions/session-actions.ts`
- Test: `apps/web/src/server/session-actions.integration.test.ts`

- [ ] **Step 1: Write the failing test**

Assert that signing out revokes the session row, and that `getCurrentUser` refuses the same token afterwards. Revoking, not merely clearing the cookie, is the property under test.

- [ ] **Step 2: Run it and watch it fail**

Run: `npx turbo run test --force --filter=web`

- [ ] **Step 3: Implement**

```ts
'use server';

import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SESSION_COOKIE_NAME } from '@luma/auth';
import { databaseSessionStore, getCurrentUser } from '../session';
import { getWebDb } from '../db';

/**
 * Sign out (spec §10).
 *
 * **Revokes the session row, not just the cookie.** `validateSession` reads
 * `revoked_at` on every request, so revoking is what actually ends a session;
 * clearing the cookie alone leaves a live session behind that anything still
 * holding the token could use.
 *
 * Written now because the terms gate makes it load-bearing: without it, a user
 * who declines new terms can only leave by deleting their account.
 */
export async function signOutAction(): Promise<void> {
  const user = await getCurrentUser();
  if (user) {
    await databaseSessionStore(getWebDb()).revoke(user.sessionId, new Date());
  }

  const jar = await cookies();
  jar.delete(SESSION_COOKIE_NAME);

  redirect('/');
}
```

- [ ] **Step 4: Add it to the navigation**

Render a form posting to `signOutAction` in `apps/web/app/(app)/_components/nav-tabs.tsx` (or the layout beside it), and on the re-acceptance page from Task 10. It must work without client JavaScript, like every other form in this app.

- [ ] **Step 5: Run and commit**

```bash
git commit -m "Let a user leave without deleting their account"
```

---

## Task 9: The exempt route group

**Files:**
- Create: `apps/web/app/(konto)/layout.tsx`
- Move: `apps/web/app/(app)/innstillinger/slett-konto/` → `apps/web/app/(konto)/innstillinger/slett-konto/`

- [ ] **Step 1: Create the layout**

```tsx
import type { ReactNode } from 'react';
import { requireUser } from '@/server/session';

/**
 * Signed in, but deliberately outside the terms gate.
 *
 * A Next.js layout does not receive the pathname, so `(app)`'s gate cannot
 * exempt one child. These routes must stay reachable while an acceptance is
 * outstanding:
 *
 * - the acceptance page itself, or the gate is an infinite redirect;
 * - account deletion, because "accept our new terms or you cannot delete your
 *   data" is exactly backwards;
 * - sign-out, so the gate is not a trap.
 *
 * Route groups do not change URLs, so every path here is what it was.
 */
export default async function KontoLayout({ children }: { children: ReactNode }) {
  await requireUser();
  return <div className="flex flex-col gap-xl">{children}</div>;
}
```

- [ ] **Step 2: Move the deletion page**

```bash
git mv "apps/web/app/(app)/innstillinger/slett-konto" "apps/web/app/(konto)/innstillinger/slett-konto"
```

- [ ] **Step 3: Verify the URL did not change**

Run: `npx turbo run typecheck lint test --force --filter=web`
Expected: PASS. Any test or link referencing `/innstillinger/slett-konto` must still pass untouched — if one breaks, the move changed a URL and that is a bug, not a test to update.

- [ ] **Step 4: Commit**

```bash
git commit -m "Put the ways out of the service where a gate cannot close them"
```

---

## Task 10: The re-acceptance page and its action

**Files:**
- Create: `apps/web/app/(konto)/vilkar/godta/page.tsx`
- Modify: `apps/web/src/server/actions/legal-actions.ts`

- [ ] **Step 1: Write the accept action**

Append to `legal-actions.ts`:

```ts
/**
 * Accepting the terms version the user was shown (§20.1).
 *
 * The version comes from the form rather than being re-read as "whatever is
 * current now". If a newer version is published between render and submit, the
 * user accepts the one they actually read and the gate catches them again on
 * the next request -- which is correct, because they have not seen the newer
 * one.
 */
export async function acceptTermsAction(formData: FormData): Promise<void> {
  const user = await requireUser();
  const version = String(formData.get('versjon') ?? '');
  const returnPath = safeReturnPath(String(formData.get('retur') ?? ''));

  const db = getWebDb();
  const [documentVersion] = await db
    .select({
      version: schema.legalDocumentVersions.version,
      body: schema.legalDocumentVersions.body,
      effectiveFrom: schema.legalDocumentVersions.effectiveFrom,
    })
    .from(schema.legalDocumentVersions)
    .where(
      and(
        eq(schema.legalDocumentVersions.kind, 'terms'),
        eq(schema.legalDocumentVersions.version, version),
      ),
    )
    .limit(1);

  // An unknown version is a stale or forged form, not a state to record.
  if (!documentVersion) redirect('/vilkar/godta');

  await db.transaction(async (tx) => {
    await recordTermsAcceptance(tx, {
      userId: user.id,
      version: documentVersion.version,
      body: documentVersion.body,
      effectiveFrom: documentVersion.effectiveFrom,
      now: new Date(),
      ipAddressHash: null,
      userAgent: null,
      source: 'settings',
    });
  });

  redirect(returnPath ?? '/oversikt');
}
```

Use the existing sanitiser in `apps/web/src/lib/return-path.ts` for `safeReturnPath` — do not write a second one. Read that file for the exported name and use it verbatim.

- [ ] **Step 2: Write the page**

`apps/web/app/(konto)/vilkar/godta/page.tsx` calls `outstandingTerms`; when it returns `null` the user owes nothing and the page redirects to `/oversikt` rather than showing an acceptance form for something already accepted. Otherwise it renders the version, the body, a hidden `versjon` and `retur` field, an accept button, and a sign-out form.

- [ ] **Step 3: Run and commit**

```bash
git commit -m "Give the outstanding acceptance somewhere to happen"
```

---

## Task 11: The gate itself

**Files:**
- Modify: `apps/web/src/server/session.ts`, `apps/web/app/(app)/layout.tsx`, every write action under `apps/web/src/server/actions/`

- [ ] **Step 1: Write `requireCurrentTerms`**

```ts
/**
 * The signed-in user, or a redirect to the outstanding acceptance (§20.1).
 *
 * Called by `(app)/layout.tsx` and again by every action that writes. A layout
 * is not a security boundary: Next does not re-run it for a server action and a
 * route handler bypasses it entirely, which is the same reason `requireUser`
 * is repeated in the actions.
 */
export async function requireCurrentTerms(returnPath?: string): Promise<SignedInUser> {
  const user = await requireUser(returnPath);
  const outstanding = await outstandingTerms(getWebDb(), user.id);
  if (outstanding) {
    redirect(returnPath ? `/vilkar/godta?retur=${encodeURIComponent(returnPath)}` : '/vilkar/godta');
  }
  return user;
}
```

- [ ] **Step 2: Call it from the layout**

Replace `await requireUser();` with `await requireCurrentTerms();` in `apps/web/app/(app)/layout.tsx`, and extend its doc comment to say the gate is here for the same reason the auth check is.

- [ ] **Step 3: Call it from write actions**

In every action under `apps/web/src/server/actions/` that writes on behalf of a user, replace `requireUser()` with `requireCurrentTerms()`. Leave `requireAdmin()` alone — an administrator publishing terms must not be gated by the terms they are publishing.

- [ ] **Step 4: Run and commit**

```bash
git commit -m "Stop the service being used under terms nobody agreed to"
```

---

## Task 12: The tests that make the gate mean something, and the records

**Files:**
- Create: `apps/web/src/server/terms-gate.integration.test.ts`
- Modify: `docs/spec-deviations.md`, `docs/launch-readiness.md`, `packages/db/README.md`

- [ ] **Step 1: Assert the gate fires and does not over-fire**

Cover: a user with an outstanding acceptance is redirected to `/vilkar/godta`; a user who has accepted is not; accepting writes exactly one `user_legal_acceptances` row and exactly one `consent_events` row; a second submit of the same version writes neither; accepting the terms grants no `marketing_email` consent.

- [ ] **Step 2: Derive the exempt set rather than listing it**

Walk `apps/web/app/(app)` on disk and assert every `page.tsx` is behind the gate, and that the four exempt paths are not. A hand-written list is a guard keyed on spelling: it stays green while a page added next month sits outside it.

```ts
it('every page under (app) is behind the gate', async () => {
  const pages = await readdir(new URL('../../app/(app)', import.meta.url), {
    recursive: true,
  });
  const routes = pages.filter((entry) => String(entry).endsWith('page.tsx'));
  expect(routes.length).toBeGreaterThan(5);
  // The gate is the layout, so membership of the group IS the assertion; what
  // this guards is that nobody moved a page out of the group quietly.
  for (const route of routes) {
    expect(String(route)).not.toContain('slett-konto');
  }
});
```

- [ ] **Step 3: Show the gate can go red**

Disable the gate — call `requireUser` in place of `requireCurrentTerms` in a copy of the layout's logic, or stub `outstandingTerms` to return `null` — and assert the blocked route becomes reachable. A gate never demonstrated failing is not evidence, and this one protects a legal property.

- [ ] **Step 4: Assert public routes are unaffected**

`/delt/[token]`, `/finn-anbud`, `/kunngjoring/[id]` and the landing pages are outside `(app)` and must stay reachable with an outstanding acceptance and with no session at all.

- [ ] **Step 5: Update the records**

- `docs/spec-deviations.md` — a new row: this flow is in neither v2 nor v3, built because §51 blocker 2's obligation cannot be met without it.
- `docs/launch-readiness.md` — blocker 2 moves to **done on the engineering half**; the terms text stays **external** and the entry must keep saying so. Note that sign-out was built here and why.
- `packages/db/README.md` — how to publish a terms version.

- [ ] **Step 6: Full gates**

```bash
npx turbo run typecheck lint test --force
pnpm check:citations
pnpm format:check
```

Expected: all pass, 0 skipped tests with `DATABASE_URL` set.

- [ ] **Step 7: Commit**

```bash
git commit -m "Make the terms gate something a test would notice losing"
```

---

## Self-review notes

**Spec coverage.** Every section of the design maps to a task: publishing (2, 3, 4, 5), detection (1, 7), the gate (11), exempt routes (9), the page (10), recording (6), sign-out (8), testing (12), records (12). Nothing in the design is unimplemented.

**Known soft spots in this plan, stated rather than discovered later.**

1. Task 3's migration assumes constraint names and a `legal_documents.kind` column that were **not** verified against `0000_initial_schema.sql`. The step says to check first; if the shape differs, the `ON CONFLICT` targets change.
2. Task 12 Step 2's enumeration test is the weakest step here. Membership of a route group *is* the gate, so a directory walk can only prove a page was not moved out — it cannot prove the gate ran. The stronger assertion is to drive each route and check the redirect, which needs a request-level harness `apps/web` does not have. Build the weak version, and say so in the test's comment rather than letting it read as full coverage.
3. `TestDatabase`'s teardown method is written as `harness.destroy()` throughout. Confirm the real name in `packages/db/src/testing/harness.ts` before writing the first integration test and use whatever is there.
