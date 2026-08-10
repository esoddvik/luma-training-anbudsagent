# Documentation index

Documentation for **Luma Anbudsvarsling**, the free Norwegian public-tender alert service from Luma Training.

The authoritative product specification is **`Luma_Anbudsvarsling_IDE_Agent_Specification_v2.md` in the repository root** (Norwegian bokmål, 54 sections). It defines the product, the trust contract, the data model, the phases and the launch blockers. Everything in this directory explains or records decisions about how that specification is implemented. Where a document here conflicts with the spec, the spec wins, unless an ADR records the deviation deliberately.

**`Luma_Anbudsvarsling_IDE_Agent_Specification_v3.md`** sits beside it and supplements it: the search-first funnel, Anbudsvarsling Pluss, the document pipeline and the split MCP scope. It renumbers nothing, so the two number-spaces overlap and mean different things — v3 §3 is the search-first funnel, v2 §3 is the trust contract. A citation therefore names v3 explicitly («IDE Agent Spec v3, section 3.2») or it is a v2 citation, and `scripts/check-citations.js` resolves each form against its own document. Where v2 and v3 conflict, v3 wins; it says so itself.

Customer-facing text is Norwegian. Code, schema, logs and these documents are English, as permitted by spec §6.

## Start here

| Document | What it covers |
| --- | --- |
| [`architecture.md`](architecture.md) | The system overview. Three services, the package graph, the ingest-to-digest data flow, the trust boundary between tender data and marketing, the Vercel/Railway split, and the open questions. Read this first. |
| [`adr/`](adr/) | Architecture decision records. Sixteen accepted decisions, listed below. |
| [`deployment.md`](deployment.md) | Operator guide: what runs where, Vercel and Railway configuration, environment variable names per service. |
| [`phase-7-billing-reference.md`](phase-7-billing-reference.md) | The v1 order and subscription model, kept as reference for phase 7 per spec §28.3. Nothing in it is implemented. |
| [`spec-sync.md`](spec-sync.md) | The v3 specification is authored in Rable and copied into this repository. Which direction of drift CI catches, which it structurally cannot, and how to re-export. |

## Architecture decision records

Spec §49 requires fifteen ADRs. ADR-0016 is an addition covering authentication, which the spec left open between Auth.js and another maintained TypeScript solution.

| ADR | Decision | One line |
| --- | --- | --- |
| [0001](adr/0001-monorepo-and-deployment-split.md) | Monorepo and deployment split | Standalone pnpm + turborepo monorepo, three deployed services: `web` on Vercel, `core` and `mcp` on Railway. |
| [0002](adr/0002-stable-mcp-sdk.md) | Stable MCP SDK | `@modelcontextprotocol/sdk` pinned to exactly 1.30.0, stable Streamable HTTP only, no alpha features, because the MCP server is a live demo surface. |
| [0003](adr/0003-mcp-authentication.md) | MCP authentication | Bearer tokens, hashed at rest and shown once, with per-call scope checks and a `SecurityContext` seam that OAuth can later plug into. |
| [0004](adr/0004-deterministic-matching.md) | Deterministic matching | Matching is a pure, versioned function with no AI and no I/O; every point scored produces a stored, explainable reason. |
| [0005](adr/0005-postmark-message-streams.md) | Postmark message streams | Three streams (transactional, tender-notifications, luma-marketing) so a marketing complaint can never suppress a magic login link. |
| [0006](adr/0006-separation-of-ranking-and-marketing.md) | Separation of ranking and marketing | `packages/matching` has no import edge to attribution or the editorial layer; attribution data is never a matching input. |
| [0007](adr/0007-source-neutral-tender-adapter.md) | Source-neutral tender adapter | Everything behind `TenderSourceAdapter`, so a future TED adapter implements the same contract; no Doffin field name leaks past the adapter, and no field is invented. |
| [0008](adr/0008-queue-technology.md) | Queue technology | pg-boss 12.x on the same PostgreSQL, no Redis, for transactional job enqueue and one less stateful service. |
| [0009](adr/0009-append-only-consent.md) | Append-only consent | Consent is an immutable event log; withdrawal inserts a new event and current status is derived from the latest one. |
| [0010](adr/0010-manual-invoicing-before-billing-system.md) | Manual invoicing before a billing system | MVP handles orders manually behind a `BillingProvider` interface; a real billing system comes when volume proves the need; Stripe is deprioritized. |
| [0011](adr/0011-legal-document-versioning.md) | Legal document versioning | Immutable document versions with an insert-only acceptance history, and a startup check that blocks launch on placeholder legal text. |
| [0012](adr/0012-norwegian-only-customer-language.md) | Norwegian-only customer language | All customer text in Norwegian bokmål, no i18n framework and no language selector; English stays internal. |
| [0013](adr/0013-pre-announcement-signals-scope.md) | Pre-announcement signals scope | Early signal comes only from Doffin notice types in the MVP; framework-agreement expiry is the first extension; municipal sources are out of scope. Contains the unverified phase 8 data gate. |
| [0014](adr/0014-promotion-ladder-and-regional-routing.md) | Promotion ladder and regional routing | Promotion sequencing and Oslo-region routing are an editorial layer driven by declarative attributes, never by matching or behavioural data. |
| [0015](adr/0015-sharing-links-as-growth-channel.md) | Sharing links as a growth channel | Public share links are the main organic spread mechanism, with a hard privacy boundary: no sharer identity, no profile values, noindex, revocable. |
| [0016](adr/0016-custom-passwordless-auth.md) | Custom passwordless authentication | A shared `packages/auth` implementing magic links and opaque database-backed sessions, because three runtimes must validate the same session identically. |

### ADR conventions

Every ADR uses the same structure: status, date, deciders, spec reference, then Context, Decision, Consequences (positive and negative), Alternatives considered, and Verification.

The **Verification** section is the one that matters most in review. It states concretely how a reviewer or an automated test can confirm the decision is actually honoured in the codebase, rather than merely intended. An ADR whose verification section cannot fail is not doing its job.

ADRs are numbered sequentially and are not deleted. A superseded decision gets a new ADR and a status change on the old one.

## Documents that do not exist yet

These are known gaps, not oversights:

- **Runbook.** Required by spec §50 phase 6 (backup, restore, incident response, alert handling). Written during phase 6.
- **MCP demo script.** Required by spec §50 phase 5. The five-minute connect, find matches, explain match sequence used at webinars and course days.
- **Doffin field findings.** The record of what real Doffin data actually contains, produced in phase 1. Its most important finding, whether award notices expose supplier name and contract duration, is the gate for phase 8 and lands as an update to ADR-0013.
