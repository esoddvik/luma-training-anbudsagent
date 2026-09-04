# Terms re-acceptance — design

Spec §51 blocker 2. Status of this document: agreed design, not yet implemented.

## The problem, stated exactly

Signups since the search-first entry door record a terms acceptance at
confirmation time, and the version they accept is the **placeholder**. Every
user recruited before the real text exists has agreed to a draft.

`getLegalStatus` in `apps/core` already reports `outstanding: true` the moment a
newer version exists, so the data side is ready. Nothing acts on it. Publishing
real terms without a flow that acts on it would leave those users' only recorded
acceptance pointing at a document nobody wrote.

`launch-readiness.md` states the obligation as: the flow must be built **at the
same time as** the terms text, not after it. This document is the flow. The text
remains Luma's to write (§19: «Endelige juridiske vilkår skal ikke publiseres
uten gjennomgang»).

## What exploration turned up

Four facts shaped the design. Three were not previously written down anywhere.

1. **Nothing ever publishes a terms version.** `legal_document_versions` is
   created in `0000_initial_schema.sql` and never populated — no seed, no
   migration insert, no admin surface, no script. Only tests insert rows. On a
   fresh production database the table is empty and `confirmSignup` returns
   `no_terms`, so **signup does not work on a clean deploy**. A flow that
   triggers on "a newer version exists" needs a way for a version to exist at
   all, so the publishing path is in scope.

2. **There are two sources of truth for the version.** `/vilkar` renders
   hardcoded Norwegian prose and stamps `TERMS_VERSION = '2026-01-utkast'` from
   `apps/web/src/lib/legal.ts`. The database row is separate and unrelated. A
   user can accept version X while reading the text of version Y, and nothing
   detects it.

3. **`getLegalStatus` has no consumer.** It lives in `apps/core` and is exposed
   on the account route. The web app reads the database directly through
   `src/server/`, so it has never called it.

4. **A Next.js layout does not receive the pathname.** This rules out gating in
   `(app)/layout.tsx` with an exemption list for particular children, which was
   the obvious first design.

## Decisions

| Decision | Why |
| --- | --- |
| Hard block, not a banner | §20.1 says the user **must** accept. A banner a user can ignore indefinitely leaves the problem it exists to solve half-solved: usage under unaccepted terms keeps accumulating. |
| Publishing path in scope | Without it the trigger can only be exercised in tests, and the clean-deploy signup gap stays open. See finding 1. |
| Terms text as a content module | Collapses finding 2 into one source. The text is authored by Luma and committed; the mechanism is engineering's. |
| Gate in the layout, defended again in write paths | The doctrine already written in `(app)/layout.tsx`: a layout keeps *pages* honest, and actions defend themselves because Next does not re-run a layout for a server action and a route handler bypasses it entirely. |
| Exempt pages move to a sibling route group | Finding 4 leaves no other way. Route groups do not change URLs. |
| `terms` only, not `privacy` | The privacy policy is an external URL (`LUMA_PRIVACY_POLICY_URL`) with no in-app document version to accept. Gating on `privacy` would block every user forever. |

### Rejected: middleware

One chokepoint, and it would catch route handlers too. Rejected because there is
no middleware in this app today, session validation is a live database read, and
it would put a third implementation of "expired, revoked, idle" next to the two
that `session.ts` says are deliberately kept from drifting apart by importing
`validateSession` rather than reimplementing it.

## Components

### 1. Publishing

**`packages/content/src/legal-documents.ts`** — the terms document as committed
content: `kind`, `version`, `effectiveFrom`, `isPlaceholder`, `body`. `/vilkar`
renders this instead of hardcoded prose, and `lib/legal.ts`'s `TERMS_VERSION`
constant is deleted rather than left as a second answer.

**`apps/web/src/server/legal-documents.ts`** — `loadLegalDocumentDrift()` and
`applyLegalDocumentDrift()`, modelled on `admin-service-templates.ts`.

**`/admin/vilkar`** for a human, **`/synk-vilkar`** for a machine, the latter
signed with `CRON_SECRET` through the existing `machineSignatureMatches`. One
way to authenticate a machine call in this app, not two.

**One deliberate inversion from the template sync.** That route *updates*
drifted rows. This one must never update or delete a version row.
`user_legal_acceptances` carries a composite foreign key onto
`(kind, version)`, and editing a published version retroactively changes what
people agreed to — which is the specific thing ADR-0011 exists to prevent. So:

- a version in the content module with no row → **inserted**;
- a version whose row exists but whose body differs → **reported and refused**,
  never applied;
- a row with no content entry → **reported**, never deleted.

The refusal is the interesting case and needs to be loud: it means someone
edited published legal text in place, which is a mistake that must be corrected
by publishing a new version, not by making the table agree.

**Migration 0008** seeds the current placeholder version so a clean deploy can
sign up before anyone runs the sync. The migration carries the row as a
historical fact; a test asserts it matches the content module's placeholder
entry, because two hand-maintained copies of a version string is finding 2
happening again.

### 2. Detection

The `outstanding` decision moves into `@luma/domain` as a pure function over
(current version, accepted version). `apps/core`'s `getLegalStatus` and the new
web-side check both call it. Copying core's logic into web is how two runtimes
start disagreeing about a fact with legal weight — the same argument
`machine-signature.ts` makes about being written twice.

### 3. The gate

`requireCurrentTerms()` beside `requireUser()` in `src/server/session.ts`.
Called by `(app)/layout.tsx`, and called again by every server action that
writes.

Redirects to `/vilkar/godta?retur=<sanitised path>`.

When no version is in force at all, the gate does **not** fire. There is nothing
to accept, and `getLegalStatus` already treats it that way
(`Boolean(current) && ...`). Blocking here would take the service down for
everyone the moment the table was empty.

### 4. Exempt routes

A new route group `(konto)` whose layout calls `requireUser()` and not the gate:

| Route | Why it must stay reachable |
| --- | --- |
| `/vilkar/godta` | The acceptance page itself. Gating it is an infinite redirect. |
| `/vilkar` | Reading what you are being asked to accept. Already public. |
| `/innstillinger/slett-konto` | "Agree to our new terms or you cannot delete your data" is exactly backwards. |
| `/innstillinger/eksport` | A route handler, so it bypasses layouts already; it stays outside the gate deliberately and not by accident. Portability must not be conditional on acceptance. |

**There is no sign-out in this application.** `databaseSessionStore` exposes
`revoke()` and nothing in any page, action or route calls it — the design
originally listed sign-out as a fifth exempt route and the route does not exist.

That matters here more than it did before. Until now a session simply expired;
under a hard block, a user who declines the new terms has exactly one way out of
the gate, which is deleting their account. "Refuse our terms and your only
option is to destroy your data" is not a defensible position for a service whose
terms are the thing being changed.

**Open question for the owner, and the one thing this design does not settle.**
Either sign-out is built as part of this work — a server action calling the
existing `revoke()` and clearing the cookie, small and self-contained — or the
gate ships knowing deletion is the only exit and that is recorded as a deliberate
choice in `launch-readiness.md`. This document assumes the former; if the answer
is the latter, the exempt-route table loses a row and the reasoning above must be
written down rather than dropped.

Public and shared surfaces — `/delt/[token]`, `/finn-anbud`,
`/kunngjoring/[id]`, the landing pages — are outside `(app)` and unaffected by
construction. That is asserted rather than assumed.

### 5. The page

`/vilkar/godta` renders the body of the version actually in force, read from the
database, and accepts **the version the user was shown** rather than whatever is
current at submit time. If a newer version lands between render and submit the
user is gated again on the next request, which is correct: they have not seen
the newer one.

### 6. Recording

`recordTermsAcceptance` is currently private inside `registration.ts`. It moves
to `src/server/legal.ts` and both callers use it. Insert-only: one
`user_legal_acceptances` row and one mirrored `consent_events` row, already
`onConflictDoNothing` so a double submit appends nothing. The consent log is
append-only and a spurious row can never be cleaned up.

## Testing

Integration, against a real database:

- the gate fires when an acceptance is outstanding, and does not when it is not;
- each of the five exempt routes is reachable while an acceptance is
  outstanding;
- accepting writes exactly one acceptance row and exactly one consent event, and
  a second submit of the same version writes neither;
- accepting the terms grants no marketing consent (the existing assertion, kept
  passing across the new path);
- the sync inserts a new version, refuses a changed body on an existing version,
  and never deletes;
- public routes are unaffected.

Two that carry more weight than the rest:

**The exempt set is derived, not listed.** The test walks `app/(app)` on disk
and asserts every page is behind the gate. A hand-written list is a guard keyed
on spelling: it stays green while a page added next month sits outside it.

**The gate is shown to fail.** A test disables it and asserts the blocked route
becomes reachable. A gate never demonstrated going red is not evidence, and this
one protects a legal property rather than a functional one.

## Records to update

- `docs/spec-deviations.md` — this flow is in neither v2 nor v3 and must be
  recorded as a deliberate addition with its reason.
- `docs/launch-readiness.md` — blocker 2 moves to *done on the engineering
  half*; the terms text stays **external**. The entry must keep saying so.
- `packages/db/README.md` — the publishing path, once it exists.

## Explicitly out of scope

- **Writing any terms text.** §19, and `launch-readiness.md`: engineering must
  not write it.
- **The `privacy` document kind.** See Decisions.
- **Notifying users by email that terms changed.** A separate question with its
  own consent implications; the gate is what makes acceptance happen.
- **Re-accepting on behalf of a user, or bulk-accepting.** There is no lawful
  version of this.
