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
| §11: `AlertProfile.active` on creation | New profiles are created **paused** | §9.1 orders the journey preview (11) → adjust (12) → activate (13). Activating on creation would send a digest built from criteria nobody has looked at yet. |
| §14 confidence bands | Only `high` triggers an immediate alert | §9.3 says "høy relevans" without defining it. Interrupting someone for a medium match gets the service muted, after which the high ones stop arriving too. |

## Known gaps: specified, not built

These are not deviations. They are parts of the specification that nothing implements yet, listed here because a gap that nobody wrote down is indistinguishable from a gap nobody noticed.

- **The web app does not talk to the API.** Nothing under `apps/web` references `/api/v1` or sends the `x-luma-csrf` header. The dashboard reads the database directly in server components, which is by design, but login is a dead end: `/logg-inn/bekreft` exists as a route and does not yet POST the token to `/api/v1/auth/redeem`. **Until this is joined up, nobody can actually sign in.**
- **`/api/v1/company` and `/api/v1/postmark/webhooks/:stream` are not implemented** (§39). The webhook path is already exempted from the CSRF guard for whoever adds it, since Postmark authenticates with its own credentials and is not a browser.
- **Consent withdrawal does not reach Postmark.** §21 and ADR-9 require withdrawal to propagate to suppression. The API records the event and logs; no queue is wired into `apps/core`, so the reconciliation is still owed by a worker.
- **`share_created` and `share_viewed` have nowhere to go.** §44.1 lists them, but `attribution_event_type` has only the four `tool_to_*` and `share_to_signup` values. `tender_shares.view_count` is the only view signal today. Adding them needs an enum value and a migration.
- **Terms acceptance is not mirrored into `consent_events`.** It is recorded in `user_legal_acceptances`. §21 lists `terms_acceptance` and `privacy_acknowledgement` as consent types, so `GET /consents` currently reports `terms_acceptance: false` for a user who has accepted the terms. §20.1 insists terms acceptance is not marketing consent, which is why they were kept apart, but the reporting inconsistency is real.
- **No admin notification template exists.** §28.2 requires notifying `BILLING_ADMIN_EMAIL` about a new order; §25's nine templates have no admin variant, so the billing address receives a copy of the customer's confirmation. It carries every invoicing field but is addressed to the customer.
- **`SenderIdentity.postalAddress` is a hard-coded constant.** §48 defines no environment variable for it and the email footer requires it.
- **The Playwright specs skip without seed data.** They read `E2E_SESSION_COOKIE`, `E2E_SHARE_TOKEN` and similar. A CI leg that does not set them passes having verified nothing — including the shared-view privacy check, which is the one worth having. Whichever job runs them must assert the variables are set.

## Still open

These are not deviations yet. They are decisions the specification leaves to Luma, recorded here so they are not mistaken for oversights.

- **`OSLO_REGION_CODES` membership.** Which NUTS codes count as "the Oslo region" for routing the full-day course (§23.2) is an editorial call.
- **Industry template content.** §11.2 requires Luma to review the five templates before launch. What is in `packages/content` is a considered starting point from the standard CPV divisions, not verified editorial content.
- **Framework-expiry estimates.** Whether to ship an explicitly uncertain estimated renewal date, given that the real end date is unavailable, is a product decision.
- **Consent retention on account deletion.** How long `consent_events` survive a deleted account needs Luma's retention policy and legal review.
