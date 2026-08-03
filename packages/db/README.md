# @luma/db

The Drizzle schema, the migrations, and the connection to PostgreSQL.

This package is the **single owner of the schema**. The generated SQL in
`drizzle/` is the only way the database changes; no other package writes DDL.

---

## Getting a database

```bash
docker compose up -d              # from the repository root
pnpm --filter @luma/db db:migrate
```

`docker-compose.yml` at the root runs PostgreSQL 16 with database
`luma_anbudsvarsling`, user and password `luma`. pg-boss creates its own
`pgboss` schema inside the same database on first worker start (ADR-8) — there
is no separate queue service.

## Scripts

| Script        | What it does                                                                 |
| ------------- | ---------------------------------------------------------------------------- |
| `db:generate` | Diffs `src/schema/` against the last snapshot and writes a new migration.     |
| `db:migrate`  | Applies pending migrations. Needs only `DATABASE_URL`, nothing else.          |
| `db:studio`   | Opens Drizzle Studio against `DATABASE_URL`.                                  |
| `db:push`     | Applies the schema directly, **without** writing a migration.                 |
| `test`        | Unit tests always; integration tests only when `DATABASE_URL` is set.         |

`db:push` is for throwaway local experiments only. Never point it at a deployed
environment: it changes the database without leaving a migration behind, so the
next `db:migrate` in CI will disagree with reality.

`db:migrate` reads `DATABASE_URL` directly rather than through
`getCoreEnv()`. That is deliberate — a migration needs a connection string and
nothing else, and validating the whole service environment would make a schema
release fail on a missing Postmark token.

### Adding a migration

```bash
# after editing src/schema/*.ts
pnpm --filter @luma/db db:generate
pnpm --filter @luma/db db:migrate
```

For something drizzle-kit cannot express — a trigger, a comment, a backfill —
use the custom form, which writes an empty file plus the journal and snapshot
entries:

```bash
pnpm --filter @luma/db exec drizzle-kit generate --custom --name=what_it_does
```

Then write the SQL into the generated file. `0001_append_only_consent_guard.sql`
is the worked example.

### Resetting a local database

There is no `db:reset` script, on purpose: a command that drops a database is a
command that will eventually be run against the wrong one. Do it explicitly.

```bash
# Nuclear, and the one to prefer: destroys the volume and starts clean.
docker compose down -v && docker compose up -d
pnpm --filter @luma/db db:migrate
```

```bash
# Or, keeping the container:
docker exec luma-postgres psql -U luma -d luma_anbudsvarsling \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public; DROP SCHEMA IF EXISTS drizzle CASCADE;'
pnpm --filter @luma/db db:migrate
```

Integration tests each create a throwaway `luma_test_<uuid>` database and drop
it afterwards. A crashed run can leave one behind; to clear them:

```bash
docker exec luma-postgres psql -U luma -d postgres -tAc \
  "SELECT 'DROP DATABASE \"' || datname || '\" WITH (FORCE);' FROM pg_database WHERE datname LIKE 'luma_test_%'" \
  | docker exec -i luma-postgres psql -U luma -d postgres
```

---

## Table map

Which file owns which tables. Spec §37 is the source of the inventory.

| File                     | Tables                                                                                                                                              |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `schema/auth.ts`         | `users`, `sessions`, `magic_link_tokens`, `companies`, `company_memberships`                                                                          |
| `schema/tenders.ts`      | `tenders`, `tender_cpv_codes`, `tender_regions`, `tender_municipalities`, `tender_revisions`, `tender_change_events`                                  |
| `schema/profiles.ts`     | `industry_templates`, `alert_profiles`, `alert_profile_cpv_codes`, `alert_profile_keywords`, `alert_profile_geographies`, `alert_profile_buyers`      |
| `schema/matching.ts`     | `tender_matches`, `tender_match_reasons`, `user_tender_states`, `relevance_feedback`, `profile_suggestions`                                            |
| `schema/sharing.ts`      | `tender_shares`                                                                                                                                       |
| `schema/notifications.ts`| `notification_preferences`, `notification_deliveries`, `notification_delivery_items`, `notification_category_unsubscribes`, `email_events`, `email_suppressions` |
| `schema/consent.ts`      | `consent_text_versions`, `consent_events`, `legal_documents`, `legal_document_versions`, `user_legal_acceptances`                                      |
| `schema/mcp.ts`          | `mcp_tokens`, `mcp_audit_events`                                                                                                                      |
| `schema/orders.ts`       | `order_requests`                                                                                                                                      |
| `schema/editorial.ts`    | `editorial_recommendations`, `editorial_impressions`, `editorial_clicks`                                                                               |
| `schema/attribution.ts`  | `attribution_events`                                                                                                                                  |
| `schema/ingestion.ts`    | `ingestion_runs`, `ingestion_checkpoints`, `ingestion_errors`                                                                                          |
| `schema/admin.ts`        | `admin_audit_events`                                                                                                                                  |

Supporting files: `schema/enums.ts` (every `pgEnum`), `schema/enum-parity.ts`
(compile-time agreement with `@luma/domain`), `schema/columns.ts` (shared
column builders).

### Departures from the spec §37 list

| Spec §37              | Here                    | Why                                                                                                    |
| --------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `accounts`            | —                       | Auth.js is not used (ADR-16).                                                                           |
| `verification_tokens` | `magic_link_tokens`     | Passwordless magic links with a hashed, single-use token (ADR-16).                                      |
| —                     | `tender_municipalities` | §13 models `municipalities`; §37 names no table. Modelled as a sibling of `tender_regions`. See below.  |
| —                     | `profile_suggestions`   | §15 requires suggested profile changes to be shown and approved, which needs somewhere to hold them.    |

---

## Constraints that exist for a legal or a privacy reason

Everything in this section looks removable and is not. If a future refactor is
about to "clean one up", this is the note that should stop it.

### `consent_events` is append-only, enforced by a trigger

`0001_append_only_consent_guard.sql` installs `luma_append_only_guard()` on
`consent_events` and `user_legal_acceptances`. It raises on **any** `DELETE`,
and on **any** `UPDATE` except one: nulling `user_id` when an account is
deleted, with every other column unchanged. That single exemption exists
because the foreign key is `ON DELETE SET NULL`, and without it spec §40's
account deletion would fail outright.

Why it matters: under GDPR consent is not a current state, it is a claim about
a past event the controller must be able to demonstrate — who consented, to
what exact wording, when, from which channel, under which policy version. An
`UPDATE` destroys that evidence. Withdrawal is a new row; re-granting is
another new row. Current status is derived by `isConsentActive()` in
`@luma/domain` from the latest event. (Spec §21, ADR-0009.)

Related, same reason:

- **`consent_events` → `consent_text_versions` composite foreign key** on
  `(consent_type, consent_text_version)`. An event cannot name a wording nobody
  wrote. `ON DELETE RESTRICT`, because deleting a wording people consented to
  would destroy the evidence.
- **`consent_events_admin_source_detail_required`**. Spec §21: an administrator
  may not create consent without a documented basis. The check makes
  `admin_recorded` and `imported` events structurally require `source_detail`.
- **`notification_preferences` has no marketing-consent column.** The
  `NotificationPreferences` type in `@luma/domain` includes
  `marketingEmailConsent` because that is what the settings screen shows; the
  read model assembles it from `consent_events`. A boolean here would be a
  second source of truth that cannot demonstrate anything. Anything writing one
  is a bug.

### `attribution_events` has no foreign key into the match tables

Spec §37 states it; ADR-0006 explains it. These rows measure the commercial
value the free service creates for Luma. Spec §44.3 says those numbers are
reported and must never steer product logic, and §4.1 promises the user that
promotion never changes which tenders they see.

Right now, breaking that promise requires a schema change. With no path from an
attribution row to a `tender_matches` row, no query can rank tenders by the
revenue they produced. `tender_id` is permitted — reporting needs to know which
surface an event came from — and `alert_profile_id`, `tender_match_id` and
`tender_match_reason_id` are not, and must not be added.
`attribution-isolation.integration.test.ts` reads `information_schema` and
fails if one appears.

### `tenders.raw_payload` must never contain user data

Spec §37. It holds exactly what the public procurement source published. It is
copied verbatim into `tender_revisions`, and an account deletion has no way to
reach inside a JSON blob — so anything personal merged in here is undeletable.

### `tender_shares.token` is random, and at least 32 characters

Spec §40: the token must not encode a user id or a tender id in cleartext, and
must not be derived from either. The shared view is public and unauthenticated,
so it is the surface an attacker would enumerate. The length check is a floor
against a future caller shortening it for nicer URLs.

### No token is stored in cleartext, anywhere

`sessions.token_hash`, `magic_link_tokens.token_hash` and
`mcp_tokens.token_hash` all hold digests. The MCP hash is additionally peppered
with `MCP_TOKEN_PEPPER`, so a database dump does not let an attacker verify a
guessed token offline. (ADR-0016, spec §30, §40.)

### Deletion policy, per table

Spec §37 asks for soft delete where recovery matters and hard delete or
anonymisation where privacy requires it. The choice is commented at every
foreign key; the shape of it:

| Behaviour on account deletion | Tables                                                                                                                | Reason                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `CASCADE`                     | sessions, magic link tokens, memberships, alert profiles, notification preferences and deliveries, saved/dismissed tenders, relevance feedback, shares, MCP tokens and audit, editorial impressions and clicks, category unsubscribes | The row is the person's own activity and has no life without them.    |
| `SET NULL`                    | consent events, legal acceptances, order requests, attribution events, email events, admin audit                        | Evidence the controller must keep, or an aggregate Luma reports on.   |
| `RESTRICT`                    | *(none reference `users`)*                                                                                              | A restricted reference would make account deletion fail — §40 forbids it. |

`users` itself is **hard-deleted**. A soft-deleted user row is still personal
data. `companies`, `alert_profiles`, `industry_templates` and
`editorial_recommendations` are soft-deleted, because they are shared or
referenced state where an accidental deletion should be recoverable and no
personal data is at stake. `tenders` are never deleted; an invalid notice is
suppressed with `suppressed_at` (spec §45), which hides it from every product
surface while leaving intact the record of what was already sent.

`account-deletion.integration.test.ts` verifies each of these claims against a
real database rather than trusting the comments.

---

## Notes from the live Doffin API

`docs/doffin-api-findings.md` invalidates several assumptions in spec §13. Four
of them are visible in this schema and are easy to misread as mistakes:

- **`tenders.notice_uuid` and `tenders.contract_folder_id`** exist and are
  populated from the eForms XML from the very first ingest. Doffin publishes a
  correction as a *new notice with a new id*; the only back-reference is by
  eForms UUID, in the XML. Without these columns, change detection cannot be
  built later without a full re-ingest.
- **`tenders.modified_at` is our observation, not the source's.** Doffin has no
  modification timestamp, filter or sort. It is not a sync watermark.
- **`ingestion_checkpoints.last_publication_date`** is named for what it holds.
  The sync pages backwards through `PUBLICATION_DATE_DESC` with an overlap
  (`overlap_days`, default 10) because publication trails issue by up to 7 days.
- **`tender_municipalities` is unpopulated in the MVP.** This is not a missing
  ingest step. Doffin exposes no municipality field; NUTS-3 (county) is the
  finest geography available, and it lands in `tender_regions`. Geography
  matching operates at NUTS-3 and must special-case `anyw` (nationwide) and
  `NOZZZ` (unspecified).

---

## Tests

Two tiers.

**Unit** — no database, always run. `schema/enums.test.ts` asserts every
`pgEnum` matches its Zod counterpart in `@luma/domain`, element for element and
in order. The compile-time half lives in `schema/enum-parity.ts` rather than in
the test, because `tsconfig.json` excludes `*.test.ts` and a type assertion in
a test file would never be checked by anything.

**Integration** — gated on `DATABASE_URL`, via
`describe.skipIf(!hasDatabase)`. Each suite creates its own throwaway database,
migrates into it, and drops it. A database rather than a schema, because
drizzle-kit emits `CREATE TYPE "public"."..."` for enums while the columns that
use them are unqualified, so a per-schema harness cannot work.

```bash
DATABASE_URL=postgres://luma:luma@localhost:5432/luma_anbudsvarsling \
  pnpm --filter @luma/db test
```

Without `DATABASE_URL` these are **skipped, not passed**. The summary line says
so; read it before believing a green run.

### The CI guard — read this before "fixing" a red pipeline

`testing/harness.ts` throws at import time when `CI` is set and `DATABASE_URL`
is not. **This is deliberate and it is not a bug.**

Thirteen integration files across `packages/db`, `apps/core`, `apps/web` and
`apps/mcp` derive their skip from `hasDatabase`. Without the guard, a CI leg
that lost its PostgreSQL service would skip all thirteen and exit 0 — reporting
success having verified nothing about the consent trigger (ADR-9), attribution
isolation (ADR-6), account deletion (§40), cross-user isolation, or the
shared-view leak. A gate that passes while skipping its own subject is worse
than no gate, because it is trusted.

If CI goes red with `DATABASE_URL is not set, but CI is`, the fix is to restore
the `postgres` service and the `DATABASE_URL` env entry on the test job in
`.github/workflows/ci.yml`. **The fix is never to delete the guard.**

`isCi` is exported from the harness. Anything else that needs to know whether
it is in CI should import it rather than parsing `process.env.CI` again —
`CI=false` is truthy as a string, and a second parser has already drifted into
that bug once.

Verified behaviour, re-run after every change to the guard:

| `CI` | `DATABASE_URL` | Expected |
| --- | --- | --- |
| `true`, `1`, `TRUE` | unset | **exit 1**, integration files fail to collect |
| `false`, `0`, empty, unset | unset | exit 0, integration suites skip |
| any | set | exit 0, nothing skipped |

Assertions use `expectRejection()` from `testing/harness.ts` rather than
`expect(...).rejects.toThrow()`. Drizzle wraps a driver failure in
`Error: Failed query: <sql>` and hangs the real `PostgresError` off `cause`, so
a plain `toThrow(/tenders_source_source_id_key/)` matches the SQL text and
passes for *any* failure — a typo, a missing column, a dropped connection.
`expectRejection` flattens the cause chain and the driver's structured fields,
and fails loudly when nothing is thrown at all.
