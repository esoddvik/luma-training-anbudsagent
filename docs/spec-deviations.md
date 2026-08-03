# Deviations from the specification

`Luma_Anbudsvarsling_IDE_Agent_Specification_v2.md` is the authoritative product document. Where the implementation departs from it, the departure is recorded here with the reason.

Most entries exist because the specification made a reasonable assumption about the Doffin API that turned out to be wrong when checked against the live service. The evidence for those is in [`doffin-api-findings.md`](doffin-api-findings.md), captured 2026-08-03.

A deviation is only legitimate if it is written down. If you find behaviour that contradicts the spec and is not listed here, treat it as a bug rather than an undocumented decision.

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

- **The login form does not yet request a link.** `/logg-inn/bekreft` now redeems a magic link and establishes a session, so an issued link works end to end. What is missing is the other half: the form on `/logg-inn` does not yet submit an address to `POST /api/v1/auth/request-link`, so in the running system a link has to be issued by other means. The API side is complete and tested.
- **Consent withdrawal does not reach Postmark from `POST /consents`.** §21 and ADR-9 require withdrawal to propagate to suppression. A withdrawal that arrives *through* the Postmark webhook now suppresses `luma-marketing` synchronously, because the suppression is the event that caused it. A withdrawal the user makes in the settings screen still only records the event and logs: propagating it means calling Postmark's suppression API, which is the `consent.sync` job's business and needs the queue. Still owed by a worker.
- **Deferred webhook work is logged, not queued.** The Postmark route hands slow follow-up — currently only the operational alert to an administrator on a transactional hard bounce, a spam complaint or a transactional suppression — to a `DeferredWorkQueue` port on `ApiContext`. Nothing implements that port yet, so `buildApiContext` falls back to a logging no-op and the alert is a log line rather than an email. Everything a user depends on (the `email_events` row, the suppression, the consent withdrawal) is written inside the request and is not affected.
- **The Playwright specs skip without seed data.** They read `E2E_SESSION_COOKIE`, `E2E_SHARE_TOKEN` and similar. A CI leg that does not set them passes having verified nothing — including the shared-view privacy check, which is the one worth having. Whichever job runs them must assert the variables are set.

## Recently closed

Kept for one release so that a reader who remembers the gap can see it was closed rather than forgotten.

- **`/api/v1/company` and `/api/v1/postmark/webhooks/:stream`** (§39) are implemented. `GET`/`PATCH /company` is the «virksomhetsprofil» of §7.1: name, organisation number, industry description and services offered, scoped through the caller's own `company_memberships` row. The organisation number is MOD-11 validated and optional, per §9.1 step 6. The webhook authenticates with HTTP basic against `POSTMARK_WEBHOOK_USERNAME` / `POSTMARK_WEBHOOK_PASSWORD` in constant time, is idempotent on `MessageID` plus event type through a unique index rather than a read-then-write, and records deliveries, bounces, complaints and subscription changes in `email_events` while maintaining `email_suppressions` on **one** stream at a time.
- **`share_created` and `share_viewed`** are in `attribution_event_type` (migration `0002_share_attribution_and_company_profile`) and are written where shares are created and viewed. A `share_viewed` row carries no viewer identity: `user_id` is null and nothing derived from the request reaches the service that writes it. ADR-6 is intact — the only tender-side reference is still `tender_id`, and nothing in matching reads the table.
- **Terms acceptance is mirrored into `consent_events`.** `POST /legal-acceptances` now appends a `terms_acceptance` or `privacy_acknowledgement` event with status `accepted`, registering the document version as the consent text version so the FK onto `consent_text_versions` resolves to the literal wording. `GET /consents` reports the truth. §20.1's distinction is preserved: the mirror can only write those two consent types, and accepting the terms grants no marketing consent.
- **The admin notification template exists.** §25 has ten templates; `renderOrderAdminNotification` is on the transactional stream and `BILLING_ADMIN_EMAIL` receives a work item rather than a copy of the customer's receipt.
- **`SenderIdentity` comes from configuration.** `SENDER_NAME`, `SENDER_POSTAL_ADDRESS` and `SENDER_CONTACT_EMAIL` replace the hard-coded constant. The footer's contact address is no longer overridden with `AUTH_EMAIL_FROM`, which had been printing the no-reply signature as the address to write to.

## Still open

These are not deviations yet. They are decisions the specification leaves to Luma, recorded here so they are not mistaken for oversights.

- **`OSLO_REGION_CODES` membership.** Which NUTS codes count as "the Oslo region" for routing the full-day course (§23.2) is an editorial call.
- **Industry template content.** §11.2 requires Luma to review the five templates before launch. What is in `packages/content` is a considered starting point from the standard CPV divisions, not verified editorial content.
- **Framework-expiry estimates.** Whether to ship an explicitly uncertain estimated renewal date, given that the real end date is unavailable, is a product decision.
- **Consent retention on account deletion.** How long `consent_events` survive a deleted account needs Luma's retention policy and legal review.
