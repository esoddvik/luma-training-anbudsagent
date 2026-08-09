# Deviations from the specification

`Luma_Anbudsvarsling_IDE_Agent_Specification_v2.md` is the authoritative product document. Where the implementation departs from it, the departure is recorded here with the reason.

Most entries exist because the specification made a reasonable assumption about the Doffin API that turned out to be wrong when checked against the live service. The evidence for those is in [`doffin-api-findings.md`](doffin-api-findings.md), captured 2026-08-03.

A deviation is only legitimate if it is written down. If you find behaviour that contradicts the spec and is not listed here, treat it as a bug rather than an undocumented decision.

The code and docs cite the spec by section throughout, and `pnpm check:citations` resolves every one of those references against the spec's own headings. It catches a citation pointing at nothing. It cannot catch the more expensive kind — a citation pointing at a real but *wrong* section, which survives any existence check and sends the reader somewhere plausible to read the wrong rule. Three of those were found by hand during the build, all three by resolving the reference and reading what was actually there. Do that when a citation matters.

That limitation is demonstrated rather than assumed. `legal.ts`'s reference to §21 for the `consentType` union was flipped to §20 and the output re-read: «Samtykkemodell» against "the consent type each legal document maps to" is a pairing any reviewer waves through, and nothing flagged it. It is wrong all the same — §21 enumerates the three consent types and §20 is the narrative about obligatory versus optional consent, so the correct citation carries information the plausible one does not. The check was written knowing it cannot see that difference.

## Forced by the Doffin API

| Spec says | Reality | What we do |
| --- | --- | --- |
| §12: incremental sync on a "modified after" watermark | No modification timestamp, filter or sort exists anywhere in the API | Watermark on `publicationDate` with a ten-day overlap. A notice can be published up to seven days after it is issued, so a tight window would drop late-published notices permanently. |
| §13: `Tender.modifiedAt` | No source field | The column means "when our ingest last observed a change", never a source watermark. Commented as such in the schema so nobody builds sync logic on it. |
| §13: `Tender.municipalities` | No municipality field; NUTS-3 (county) is the finest granularity | Left empty. Not filled from the buyer's postal city, which is where the buyer sits rather than where the work happens, and would look populated while being wrong. |
| §13: `estimatedValueMinNok` / `MaxNok` as a range | A single scalar, absent in 53% of notices, and not always NOK | Both bounds take the same value. Currency is preserved and never assumed to be kroner. Matching treats absence as no signal rather than as a penalty. |
| §13: `Tender.status` | Null for every non-competition notice; only maintained for live competitions | Derived from the notice type, with type taking precedence over a stale status value. |
| §13: change detection as updates to a notice | A correction is published as a **brand-new notice with a new id**, referencing the original only in the XML, only by eForms UUID | `notice_uuid` and `contract_folder_id` are persisted from the first ingest. They cannot be backfilled; adding them later would mean a full re-ingest. |
| §13: `sourceRevision` from a version field | `cbc:VersionID` was `01` on every notice examined, including a corrected one | Not usable as a revision counter. Change detection uses the payload hash and the eForms back-reference instead. |
| §13: `procedureType` | Available only in the eForms XML, not in the JSON | Left undefined in the MVP rather than paying one extra request per notice. |
| §14: geography matching over regions | `locationId: "anyw"` means nationwide, is not a NUTS code, and is the single most common value in the data | Parsed explicitly and surfaced as a flag. A nationwide notice matches any profile geography. Treating it as an unmatched region would silently drop about a fifth of all notices. |
| §13: category derivation from notice type | `ANNOUNCEMENT_OF_INTENT` rolls up to `RESULT` in `allTypes`, the same tag as a real award | Category derives from the single-valued `type` field only. Reading `allTypes` would classify every intensjonskunngjøring as an award and hide it from users who asked for planned procurements. |
| §54 step 7: award notices expose supplier and contract duration | Supplier yes (219/219). Duration no (2 of 10 XMLs) | Supplier watching is buildable; framework-expiry alerting is not, as specified. Recorded in [ADR-13](adr/0013-pre-announcement-signals-scope.md). |

## Search-first entry door (IDE Agent Spec v3)

A second specification document, `Luma Anbudsvarsling IDE Agent Spec v3: Søk-først, Pluss og dokumentpipeline`, supplements v2 and wins where the two conflict. It is held in Rable rather than in this repository. Fase A of it — the entry door — is implemented; Fases B, C and D are not.

| Spec v3 says | What we do | Why |
| --- | --- | --- |
| Section 3 builds on «Search-first onboarding — direction and plan» *«i repoet»* | Implemented from sections 3.1–3.3 alone | **That document does not exist.** It is not in this repository and not in Rable. Section 3 says it "applies as the implementation basis" and that v3 only settles the points left open in it, so some amount of intended design is unrecorded anywhere we can read. Sections 3.1–3.3 are concrete enough to build Fase A from; if the direction document surfaces, Fase A should be re-read against it before Fase B is built on top. |
| Section 10 lists `/registrering/sjekk-e-post` and no confirmation route | Added `/registrering/bekreft` | The confirmation link needs somewhere to land. Named to mirror `/logg-inn/bekreft`, which does the equivalent job for the magic link, rather than inventing a second convention. |
| Section 25 (v2) defines nine email templates | Eleven. `signup-confirmation-v1` is the new one | The entry door must send an email on **both** branches or the silent branch is an account-enumeration oracle. `auth-magic-link-v1` cannot serve the unknown-address branch: its copy says "log in", the recipient has no account, and the confirmation it stands in for is the terms acceptance that §20.1 requires *before* an account may exist. Reusing it would mean emailing a stranger a login link for an account nobody agreed to create. Same reasoning as the tenth template, `order-admin-notification-v1`. |
| Section 3.1: registration «med begge-grener-sender-e-post» | Both branches send, and the HTTP response is identical in text, shape and destination | Note this **inverts** `login.ts`, which deliberately sends nothing to an unknown address and documents three reasons why. Both are correct: a login link for a non-existent account cannot work, whereas creating the account *is* what registration is for. The two files each carry the argument for their own choice, because a reader who finds them contradictory is asking a fair question. |
| — | `pending_signups` is swept by `signup.cleanup` at 03:40 | Not in v2's §38 job list. An abandoned row is an email address whose lawful basis — completing the signup — expires with its token, so deleting it is an obligation under §40's data minimisation rather than housekeeping. Mirrors `share.cleanup`. |

**Known gap, not yet closed.** Users who sign up during Fase A accept the *placeholder* terms, because that is the only version in force (§51 blocker 2). The re-acceptance flow that must run when real terms are published does not exist. It is tracked in [`launch-readiness.md`](launch-readiness.md) and has to be built alongside the terms text, not after it.

### Anbudsvarsling Pluss (Fase D) — partially built, and the missing half is named

Fase D's ordering in IDE Agent Spec v3 section 11 is: entitlements and the order code, then `TendSignAdapter`, then storage and serving, then cleanup and takedown, then extraction, then the MCP scope, then the remaining adapters.

**Built:** entitlements (`user_entitlements`, migration 0007), the `pluss` product code, the pure access decision in `@luma/domain`'s `isEntitlementActive`, grant/renew/revoke/expiry-report in `apps/core/src/services/entitlements.ts`, the `documents:read` MCP scope, and the upgrade refusal shape.

**Not built:** the document pipeline in its entirety — the four KGV adapters, R2 storage, serving, reference-counted retention, the takedown switch, text extraction, and the three MCP document tools.

**Why it stops there, stated plainly rather than left as an omission.** Section 5.2 requires the adapters to be tested against *fixture-recorded HTML flows*, so that CI never depends on the KGV systems' uptime. Those fixtures have to be recorded from the real Mercell, TendSign and CTM flows, and there is no access to record them from here. An adapter written against invented HTML would pass its own tests and fail on first contact with production — the worst possible outcome, because it would look finished. Section 5.3's storage needs R2 credentials that likewise do not exist yet.

So the boundary is: everything decidable without those two dependencies is built and tested; nothing that would need fabricated evidence is. Recording one real flow per adapter family is the unblocking task, and it is a task for someone with a KGV login rather than a coding task.

**Two decisions taken while building the half that exists:**

| Decision | Why |
| --- | --- |
| An entitlement is a row keyed by `(user_id, product_code)`, not a boolean on `users` | A boolean cannot expire, cannot say who granted it or which order paid, and is one product. Section 4.2 already anticipates a course purchase granting access through the same mechanism, and Påfyll is a separate stream — a shared flag is exactly how "customer of one thing" becomes "customer of the other". |
| `documents:read` on a token is necessary but **not sufficient** | The live entitlement decides. A token outlives a subscription, so a scope granted in January must not still serve documents in December, and withdrawing access must not mean hunting down every token a user made. |

The upgrade refusal carries a test that would fail if the copy started selling: `FORBIDDEN_IN_UPGRADE_COPY` scans the rendered refusal for `påfyll` and for the urgency register §42 forbids, and a companion test proves the scan can fail.

### The landsdel dimension (Fase B)

| Spec v3 says | What we do | Why |
| --- | --- | --- |
| Section 3.2: density query over «landsdel», threshold ≈8 active hits in 90 days | Threshold 8, landsdel = NUTS level 2, result in [`search-surface-density.md`](search-surface-density.md) | 27 of 48 template × landsdel pairs qualify. The grouping is *derived* from the NUTS-3 code rather than held in a county table, because a hand-maintained table is what rots when Norway reorganises its counties — as it did in 2020 and 2024, which is why the live data carries `NO083` for Østfold where most published material still shows `NO031`. |
| Section 3.2: thresholds and query result documented | Documented, **and the measurement is flagged as provisional** | The corpus available when the query was run spanned 37 days, not 90, so every count is an undercount and the real number of qualifying pairs is higher than 27. The document says so and says to re-run before deploying the pages. |
| — | Nationwide (`anyw`) notices count towards every landsdel | Consistent with the existing rule that a nationwide notice matches any profile geography. Recorded here because it has a consequence the spec does not anticipate: for `it-tjenester-og-konsulentbistand`, 36 of the qualifying hits are nationwide, so its six regional pages are ~86% identical content. That is a near-duplicate-content problem aimed at a search engine, and it is why a regional page must show regional and nationwide notices as separate sections rather than one merged list. |

## Deliberate engineering choices

| Spec says | What we do | Why |
| --- | --- | --- |
| §35: five deployed applications (`web`, `api`, `mcp`, `worker`, `jobs`) | Three: `web`, `core` (API + worker + cron in one process), `mcp` | Fewer moving parts to operate at launch volume. The `/packages` boundaries are unchanged, so splitting `core` later is mechanical. [ADR-1](adr/0001-monorepo-and-deployment-split.md). |
| §35: "Redis eller PostgreSQL-basert kø" | pg-boss on the main PostgreSQL. No Redis | Jobs enqueue in the same transaction as the data that causes them, and there is one less stateful service. [ADR-8](adr/0008-queue-technology.md). |
| §10: "Auth.js eller annen vedlikeholdt TypeScript-løsning" | A custom `packages/auth`: magic links plus opaque database sessions | Three runtimes must validate the same session. Auth.js is Next-centric and its v5 line is pre-release, so adopting it would mean either a beta dependency on the login path or duplicated session logic in the Fastify API. [ADR-16](adr/0016-custom-passwordless-auth.md). |
| §16: admin at `/admin/anbudsvarsling/...` | `/anbudsvarsling/admin/...` | The app is served under one Next `basePath`, and a base path can only go in *front* of every route. `/anbudsvarsling/oversikt` and `/admin/anbudsvarsling` cannot both come out of one prefix. Satisfying §16's literal admin paths would mean a second routing mechanism — a rewrite layer, or a separate zone for admin — for eleven pages behind a login that answers 404 to everyone else (§45). The user-facing routes match §16 exactly; the admin ones are reordered. `apps/core`'s `adminOrderUrl` and `packages/email`'s `ADMIN_ORDER_URL` fixture follow the real path, not §16's. |
| §48: `DOFFIN_API_KEY`, `DOFFIN_API_CLIENT_ID`, `DOFFIN_API_CLIENT_SECRET` | A single `DOFFIN_SUBSCRIPTION_KEY` | The API is an Azure API Management gateway authenticating with one `Ocp-Apim-Subscription-Key` header. There is no client id or secret. |
| §48: `REDIS_URL` | Absent | Follows from the queue decision above. |
| §48 lists no variable for §40's MCP host allowlist | `MCP_ALLOWED_HOSTS` added, optional | The allowlist derives from `MCP_URL`, which §48 does list, so a single-domain deployment needs no new variable. This exists for the second domain a platform adds without being asked — Railway serves every service on a generated `*.up.railway.app` name alongside any custom one, and a client pointed at it is legitimate. Empty by default. |
| §17: `TenderShare.token` holds the token | The column holds a **peppered SHA-256 hash**, not the link | ADR-15 requires that database disclosure yield no working link, and storing the token would not give that. The plaintext link is returned once at creation and is then unrecoverable, including by the owner's own `/shares` listing. |
| §16: routes | `/logg-inn/bekreft` added | The magic link has to land somewhere. §16 lists no route for it. |
| §16: `/koble-til-ai` | Split in two: a public, informational `/ai-verktoy`, and the logged-in setup at `/integrasjoner/mcp` | §16 lists the route without saying where it sits, but §9.5 settles it — step 1 is «Brukeren åpner «Koble til AI»» and step 2 is creating a token, so it is a logged-in page. It had been built as a **public** page carrying that imperative name, which advertised a connection a visitor could not make: the token needs an account, and no step zero exists. Advertising the capability publicly is right and §7.1 puts MCP in the MVP, so the public page stays — renamed and reworded to describe the integration rather than instruct an action, with the setup itself behind login where the spec puts it. |
| §10: where redemption happens | The **web app** redeems the link and sets the cookie, rather than calling the API | `apps/web` and `apps/core` are on different hosts. A cookie set by the API would either not reach the web app or would have to be widened to `.luma-training.com`, handing it to every other host under that domain including the marketing site. Both sides call the same `@luma/auth` functions, so the single-use and expiry rules are identical. |
| §11: `AlertProfile.active` on creation | New profiles are created **paused** | §9.1 orders the journey preview (11) → adjust (12) → activate (13). Activating on creation would send a digest built from criteria nobody has looked at yet. |
| §14 confidence bands | Only `high` triggers an immediate alert | §9.3 says "høy relevans" without defining it. Interrupting someone for a medium match gets the service muted, after which the high ones stop arriving too. |

## What following §16's path prefix costs

The build originally deployed to `anbudsvarsling.luma-training.com` and dropped
the prefix. That was recorded here as a deviation; it is not one any more. The
product owner chose the spec's `luma-training.com/anbudsvarsling` for the SEO
value of inheriting a domain that already ranks, and nothing was deployed yet,
so no live link was broken by the change. This is what it bought and what it
cost, written down because most of the cost is invisible until it bites.

**One shared origin instead of two.** A subdomain is a separate origin: cookies,
CSP, Server Action origin checks and CSRF all get their boundary for free. A
path prefix on a shared domain gets none of that, and each one had to be
re-established by hand:

- **The session cookie is scoped to `/anbudsvarsling`.** At the default `path:
  '/'` the browser would attach it to every request for every page of the
  marketing site. Nothing breaks when a cookie is too wide, which is exactly why
  it needs a test — `login.integration.test.ts` asserts the path.
  `clearedSessionCookieOptions` was changed to take the same input shape as
  `sessionCookieOptions` so the compiler asks about `path` at both ends: a
  cookie set at `/anbudsvarsling` and deleted at `/` is not deleted, and the
  logout reports success either way. `SameSite=Lax` is unchanged and must stay —
  the magic-link click is a cross-site navigation.
- **Server Actions need an origin allowlist.** Behind the marketing site's
  rewrite the browser's `Origin` and this deployment's `Host` never agree, and
  Next refuses the action. `experimental.serverActions.allowedOrigins` in
  `next.config.ts` is now load-bearing for every form on the service.
- **`apps/core`'s CSRF and CORS list needs `new URL(APP_URL).origin`.** An
  `Origin` header is scheme, host and port and never a path, so `APP_URL` can no
  longer be passed to it raw.
- **HSTS `preload` from `vercel.json` now applies to `luma-training.com`
  itself**, not to a subdomain nobody else uses. See `docs/deployment.md` §5.

**`APP_URL` carries the prefix, and it is the only thing that does.**
`apps/core` mints magic links, share links and every email footer link knowing
nothing about Next's `basePath`. Two of those builders used
`new URL('/logg-inn/bekreft', APP_URL)`, which **discards the base's path** —
so every login link pointed at the marketing site's 404 page, with a URL that
parses, a host that is right, mail that sends, and nothing logged. Both now go
through `appUrlFor` in `packages/email`, whose test fails if the prefix is
dropped; that test was proved able to fail by reintroducing each form of the bug
before it was trusted. The residual risk is unautomatable: a platform settings
page where somebody types `APP_URL` without the path.

**Four places Next does not apply `basePath` for you**, each silent:

| Place | Symptom if forgotten |
| --- | --- |
| `next/image` `src` | The optimiser answers 400 and the logo is simply missing. Confirmed against the running app before and after. |
| A plain `<form action>` | The filter form submits to a path the app does not serve. `Link` and `router` are prefixed; raw HTML is not. |
| `vercel.json` `headers[].source` | Sources are matched against the arriving path. The unprefixed `/delt/:path*` entry stopped matching, and §17's `X-Robots-Tag: noindex` on a private share page would have gone with it. |
| Playwright `baseURL` | `page.goto('/oversikt')` resolves with `new URL()` — the same discard as above. `baseURL` stays the bare origin and specs go through `appPath`. |

`redirect()` and `metadataBase` **are** handled by Next; both were checked
rather than assumed (`resolve-url.js` joins `metadataBase`'s pathname;
`action-handler.js` prefixes an app-relative redirect, and a live 307 confirmed
it).

**What was not paid.** The route inventory is otherwise §16's, verbatim, for the
first time — every public and signed-in path now matches the spec exactly. Only
the admin block deviates, and it deviates for a reason a second routing
mechanism would not have made worth it (see the table above).

## Known gaps: specified, not built

These are not deviations. They are parts of the specification that nothing implements yet, listed here because a gap that nobody wrote down is indistinguishable from a gap nobody noticed.

- **Deferred webhook work is logged, not queued.** The Postmark route hands slow follow-up — currently only the operational alert to an administrator on a transactional hard bounce, a spam complaint or a transactional suppression — to a `DeferredWorkQueue` port on `ApiContext`. The port exists and `buildApiContext` still falls back to a logging no-op, so the alert is a log line rather than an email until `main.ts` passes an implementation backed by the now-wired queue. Everything a user depends on (the `email_events` row, the suppression, the consent withdrawal) is written inside the request and is unaffected.
- **The real Postmark path has never been exercised.** Every test uses `FakePostmarkClient`. `createPostmarkTransport` is constructed but has never made a call to Postmark's API, so sending, suppression and webhook delivery are proven in logic and unproven in integration. This is spec §51 blocker 5 and it needs a real account.
- **§38's «Siste kjørevindu skal registreres» is not implemented.** The digest scheduler's last run window is recorded nowhere. `ingestion_runs` is Doffin-only, and a scheduler tick that claims no work writes nothing at all, so after a quiet period there is no way to distinguish "ran and found nothing" from "never ran" — which is exactly the missing-worker case the runbook says queue depth cannot catch. Closing it needs a new table and therefore a migration.
- **Five §38 job types have a queue and no worker.** §38 names eleven; `tender.normalize` and `tender.change-detect` are deliberately folded into `runIngest`, because splitting them would let the ingest checkpoint advance past work that had not happened. But `postmark.webhook.process`, `feedback.process` and `order.request.notify` have no consumer, and the queues exist regardless — `boss.send` to a queue with no worker succeeds, returns a job id, and the row sits in `created` forever. §27 points the webhook's slow path at the first of those, so the natural wiring is also the silent one. `warnAboutUnconsumedQueues` reads the live worker list back from pg-boss and names them at startup; it is a warning, not a fix.
- **A tenth "register instead" email does not exist.** A magic link requested for an address with no account writes a token row and sends nothing, so the person waits for an email that will not arrive. The confirmation page therefore tells everyone in advance that a profile is needed, which is a workaround rather than a fix. Closing it properly means a template telling them to register, and §25's list would grow again.

## Recently closed

Kept for one release so that a reader who remembers the gap can see it was closed rather than forgotten.

- **§39's OpenAPI documentation exists.** `GET /api/v1/openapi.json` serves an OpenAPI 3.1 document generated from the same Zod schemas the handlers validate with, via Zod 4's `z.toJSONSchema` — no new dependency, and the document cannot describe a shape the API does not enforce. A test compares it against the routes Fastify actually registered, read from an `onRoute` hook, and fails in both directions: an undocumented route and a documented path that no longer exists. Verified by injecting each. The `/shared/:token` response schema derives from `sharedTenderViewSchema`, with a test asserting every `FORBIDDEN_SHARE_FIELDS` name is absent from it.
- **§40's MCP host allowlist exists**, and `apps/mcp/README.md` had claimed it did for some time before it was built. Enforced on `/mcp` only, deriving from `MCP_URL`; `/health` and `/ready` stay open so a platform probe cannot be locked out.
- **§30's per-token and per-user rate limiting exists** on the MCP surface. Both keys, since neither substitutes for the other, with a request refused by the token limit not spending user budget.

- **`/api/v1/company` and `/api/v1/postmark/webhooks/:stream`** (§39) are implemented. `GET`/`PATCH /company` is the «virksomhetsprofil» of §7.1: name, organisation number, industry description and services offered, scoped through the caller's own `company_memberships` row. The organisation number is MOD-11 validated and optional, per §9.1 step 6. The webhook authenticates with HTTP basic against `POSTMARK_WEBHOOK_USERNAME` / `POSTMARK_WEBHOOK_PASSWORD` in constant time, is idempotent on `MessageID` plus event type through a unique index rather than a read-then-write, and records deliveries, bounces, complaints and subscription changes in `email_events` while maintaining `email_suppressions` on **one** stream at a time.
- **`share_created` and `share_viewed`** are in `attribution_event_type` (migration `0002_share_attribution_and_company_profile`) and are written where shares are created and viewed. A `share_viewed` row carries no viewer identity: `user_id` is null and nothing derived from the request reaches the service that writes it. ADR-6 is intact — the only tender-side reference is still `tender_id`, and nothing in matching reads the table.
- **Terms acceptance is mirrored into `consent_events`.** `POST /legal-acceptances` now appends a `terms_acceptance` or `privacy_acknowledgement` event with status `accepted`, registering the document version as the consent text version so the FK onto `consent_text_versions` resolves to the literal wording. `GET /consents` reports the truth. §20.1's distinction is preserved: the mirror can only write those two consent types, and accepting the terms grants no marketing consent.
- **The admin notification template exists.** §25 has ten templates; `renderOrderAdminNotification` is on the transactional stream and `BILLING_ADMIN_EMAIL` receives a work item rather than a copy of the customer's receipt.
- **`SenderIdentity` comes from configuration.** `SENDER_NAME`, `SENDER_POSTAL_ADDRESS` and `SENDER_CONTACT_EMAIL` replace the hard-coded constant. The footer's contact address is no longer overridden with `AUTH_EMAIL_FROM`, which had been printing the no-reply signature as the address to write to.
- **The login form requests a link.** `/logg-inn` submits an address, rate limited per address and per hashed IP, and answers identically whether or not an account exists. A response floor was added because the known-address path makes an HTTPS call to Postmark and the unknown one does not — a timing channel far louder than the shared insert the original comment relied on. That narrows the channel rather than closing it; closing it means moving the send off the request path.
- **Consent withdrawal reaches Postmark.** `EmailClient.suppressAddress` was added, scoped to a single stream and tested for it, and the `consent.sync` job pushes each withdrawal. A global suppression would also stop magic links, so a user unsubscribing from a newsletter would experience it as losing their account.
- **The background job runtime exists.** pg-boss creates every queue, runs the three cron schedules, and chains ingest through matching, immediate alerts and the digest to sending, with retries, backoff, a dead-letter queue and a drain between HTTP close and database close. Before this, every job function was tested and none of them ever ran.
- **The Playwright specs fail rather than skip in CI.** Six seed variables are required when `CI` is set, proved in four configurations. Three of them were previously read straight from the environment behind a conditional, so the shared-view privacy check silently degraded from asserting an address is absent to asserting nothing.

## Still open

These are not deviations yet. They are decisions the specification leaves to Luma, recorded here so they are not mistaken for oversights.

- **`OSLO_REGION_CODES` membership.** Which NUTS codes count as "the Oslo region" for routing the full-day course (§23.2) is an editorial call.
- **Industry template content.** §11.2 requires Luma to review the five templates before launch. What is in `packages/content` is a considered starting point from the standard CPV divisions, not verified editorial content.
- **Framework-expiry estimates.** Whether to ship an explicitly uncertain estimated renewal date, given that the real end date is unavailable, is a product decision.
- **Consent retention on account deletion.** How long `consent_events` survive a deleted account needs Luma's retention policy and legal review.
