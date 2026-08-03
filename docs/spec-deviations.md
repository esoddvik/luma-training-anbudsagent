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

## Deliberate engineering choices

| Spec says | What we do | Why |
| --- | --- | --- |
| §35: five deployed applications (`web`, `api`, `mcp`, `worker`, `jobs`) | Three: `web`, `core` (API + worker + cron in one process), `mcp` | Fewer moving parts to operate at launch volume. The `/packages` boundaries are unchanged, so splitting `core` later is mechanical. [ADR-1](adr/0001-monorepo-and-deployment-split.md). |
| §35: "Redis eller PostgreSQL-basert kø" | pg-boss on the main PostgreSQL. No Redis | Jobs enqueue in the same transaction as the data that causes them, and there is one less stateful service. [ADR-8](adr/0008-queue-technology.md). |
| §10: "Auth.js eller annen vedlikeholdt TypeScript-løsning" | A custom `packages/auth`: magic links plus opaque database sessions | Three runtimes must validate the same session. Auth.js is Next-centric and its v5 line is pre-release, so adopting it would mean either a beta dependency on the login path or duplicated session logic in the Fastify API. [ADR-16](adr/0016-custom-passwordless-auth.md). |
| §16: routes under `/anbudsvarsling/...` | The prefix is dropped | The service deploys to its own subdomain, `anbudsvarsling.luma-training.com`, so the prefix would be duplicated in every URL. |
| §48: `DOFFIN_API_KEY`, `DOFFIN_API_CLIENT_ID`, `DOFFIN_API_CLIENT_SECRET` | A single `DOFFIN_SUBSCRIPTION_KEY` | The API is an Azure API Management gateway authenticating with one `Ocp-Apim-Subscription-Key` header. There is no client id or secret. |
| §48: `REDIS_URL` | Absent | Follows from the queue decision above. |
| §17: `TenderShare.token` holds the token | The column holds a **peppered SHA-256 hash**, not the link | ADR-15 requires that database disclosure yield no working link, and storing the token would not give that. The plaintext link is returned once at creation and is then unrecoverable, including by the owner's own `/shares` listing. |
| §16: routes | `/logg-inn/bekreft` added | The magic link has to land somewhere. §16 lists no route for it. |
| §10: where redemption happens | The **web app** redeems the link and sets the cookie, rather than calling the API | `apps/web` and `apps/core` are on different hosts. A cookie set by the API would either not reach the web app or would have to be widened to `.luma-training.com`, handing it to every other host under that domain including the marketing site. Both sides call the same `@luma/auth` functions, so the single-use and expiry rules are identical. |
| §11: `AlertProfile.active` on creation | New profiles are created **paused** | §9.1 orders the journey preview (11) → adjust (12) → activate (13). Activating on creation would send a digest built from criteria nobody has looked at yet. |
| §14 confidence bands | Only `high` triggers an immediate alert | §9.3 says "høy relevans" without defining it. Interrupting someone for a medium match gets the service muted, after which the high ones stop arriving too. |

## Known gaps: specified, not built

These are not deviations. They are parts of the specification that nothing implements yet, listed here because a gap that nobody wrote down is indistinguishable from a gap nobody noticed.

- **Deferred webhook work is logged, not queued.** The Postmark route hands slow follow-up — currently only the operational alert to an administrator on a transactional hard bounce, a spam complaint or a transactional suppression — to a `DeferredWorkQueue` port on `ApiContext`. The port exists and `buildApiContext` still falls back to a logging no-op, so the alert is a log line rather than an email until `main.ts` passes an implementation backed by the now-wired queue. Everything a user depends on (the `email_events` row, the suppression, the consent withdrawal) is written inside the request and is unaffected.
- **The real Postmark path has never been exercised.** Every test uses `FakePostmarkClient`. `createPostmarkTransport` is constructed but has never made a call to Postmark's API, so sending, suppression and webhook delivery are proven in logic and unproven in integration. This is spec §51 blocker 5 and it needs a real account.
- **§39 requires OpenAPI documentation and there is none.** Its requirement line has eight items; seven are implemented and tested. Nothing serves an API document, and no manifest or the workspace catalog carries a `swagger`/`openapi` dependency. This went unrecorded for most of the build because the route *inventory* of §39 was complete and was reported as the section being complete — routes are not the whole section. Being a bug rather than a decision until it is either built or deliberately deferred here, it is listed as a gap. Note for whoever picks it up: `@fastify/swagger` is the obvious choice and is the wrong one here, because it reflects over Fastify route schemas and this API validates with `parseOrThrow` inside handlers, so it would emit a document with paths and no shapes. Zod 4's `z.toJSONSchema()` generates from the schema objects the handlers actually use.
- **A tenth "register instead" email does not exist.** A magic link requested for an address with no account writes a token row and sends nothing, so the person waits for an email that will not arrive. The confirmation page therefore tells everyone in advance that a profile is needed, which is a workaround rather than a fix. Closing it properly means a template telling them to register, and §25's list would grow again.

## Recently closed

Kept for one release so that a reader who remembers the gap can see it was closed rather than forgotten.

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
