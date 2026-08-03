# Launch readiness

Spec §51 lists fourteen conditions that must be met before the service can be launched publicly, and §52 lists eighteen acceptance criteria. This document tracks both honestly, including the items that are not close.

**Status as of 2026-08-03: not launchable.** Several blockers are legal rather than technical and cannot be closed by engineering at all.

Login works end to end, the background job runtime runs, consent withdrawal reaches Postmark, and the §39 route list is complete. Most of what remains in this table is legal text, a security review, and integrations that need real third-party accounts. See `spec-deviations.md` for the gaps that are still genuinely open.

> **This paragraph previously claimed every gap engineering could close was closed.** It was written on the strength of the §39 *route list* being complete, and a later pass reading §39's requirement line found an eighth item, OpenAPI documentation, that nothing implemented. The same pass over §40 found that its MCP host allowlist did not exist while `apps/mcp/README.md` stated it did. Both are now tracked below. The claim is left visible rather than deleted, because the way it went wrong is the useful part: a section's route inventory is not the section, and no citation check built here could have caught the difference — auditing what you wrote finds claims that are present and wrong, never a requirement absent entirely.

Legend: **done** — implemented and covered by a test that would fail if it regressed. **partial** — the mechanism exists but is not yet joined to the running system. **open** — not started. **external** — not ours to close.

## Spec §51 launch blockers

| # | Blocker | Status | Note |
| --- | --- | --- | --- |
| 1 | Privacy policy link configured, policy reviewed | **external** | `LUMA_PRIVACY_POLICY_URL` is wired and read from one place, never hard-coded. The review of the policy itself is Luma's, and §18 lists what it has to cover. |
| 2 | Own terms written, approved, version-stored | **partial / external** | Versioning, acceptance recording and the `isPlaceholder` flag exist. The terms text does not, and must not be written by engineering. |
| 3 | Coverage text published on the landing page and in the terms | **done** | The §43 dekningstekst is on the landing page and in the MCP `luma://service/begrensninger` resource. Still needs to appear in the terms once those exist. |
| 4 | Consent text approved; consent with source and date works; withdrawal works | **partial / external** | Append-only consent events, source, timestamp and exact text version are implemented and enforced by a database trigger. Approval of the wording is Luma's. |
| 5 | Postmark streams tested | **partial** | Three streams are modelled, and a typed mapping makes it impossible to send a magic link on the marketing stream. Nothing has been sent through real Postmark yet. |
| 6 | Manual order flow documented and tested | **done** | `OrderRequest`, the `BillingProvider` seam, enforced status transitions, the admin handling routes, and a real admin notification template so the billing address receives a work item rather than a copy of the customer's receipt. Every status change is written to `admin_audit_events`. |
| 7 | Promotion separated, follows the ladder and regional routing, can be turned off | **done** | Ordering is asserted by a test verified to fail when the block is moved. The promotion-off digest is proven byte-identical to the promotion-on one minus the block. Oslo-only routing is tested. |
| 8 | All customer text Norwegian; no placeholder legal text presented as finished | **partial** | Every string written so far is Norwegian, with tests asserting no English leaks into labels. The terms page is explicitly a placeholder and flagged as one. |
| 9 | Doffin connection stable; the source's terms of use checked | **partial / external** | The adapter is verified against the live API, handles the rate limit and the 1000-hit ceiling, and is covered by tests. **Nobody has read Doffin's terms of use.** That is a real gap, not a formality. |
| 10 | Planned procurements shown correctly as their own category | **done** | Derived from the notice type, tested against a real intention notice whose roll-up says otherwise, and surfaced as its own category end to end. |
| 11 | Shared view leaks no personal data, verified in a security review | **partial** | The payload is built from a schema that strips undeclared fields, and tests assert the forbidden fields are absent. No independent security review has happened. |
| 12 | MCP token revocable; the demo runs stably | **partial** | Token hashing, revocation and scope checks are implemented and tested against a real database, and the built container answers an unauthenticated call with 401. The demo has never been run against a real ChatGPT or Claude client, which is what the blocker asks. |
| 13 | Attribution events recorded with consistent UTM | **done** | UTM tagging is centralised and idempotent. `share_created` and `share_viewed` now exist and are written where shares are created and viewed; a `share_viewed` row carries no viewer identity. The four `tool_to_*` types are recorded on the surfaces that emit them. |
| 14 | Account deletion works | **done** | Hard delete with severance where retention requires it, tested at the database level, plus a user-facing flow that requires typing the account email, and a data export that excludes share tokens and session hashes. |

## Spec §52 acceptance criteria

Met and covered by tests: deterministic and explainable matching with stored reasons (6); planned procurements as their own category (7); idempotent Doffin sync where duplicates cannot produce duplicate alerts (5); promotion that can be switched off without affecting tender content (4); the ladder and Oslo-only regional routing (12); no AI model required for anything (18); all customer text Norwegian (17).

Not yet met: signup in under five minutes (1) — the industry templates that make it possible exist, the onboarding flow does not; consent recorded at signup (2, 3) — the model is enforced, the signup path is not built; sharing and share attribution (8, 9); MCP token lifecycle in a real client (10, 11); marketing campaigns requiring consent (13) — the type-level guard exists but no campaign path does; manual order handling with an audit log (14); the attribution report (15); admin diagnosis (16).

## The gaps worth naming plainly

**Doffin's terms of use have not been read.** Everything here depends on a data source whose licensing nobody has checked. Spec §7.3 forbids scraping when the API suffices, which suggests the question was considered, but blocker 9 asks for the terms to be checked and that has not happened. This should be settled before more is built on top.

**No security review has taken place.** Blocker 11 asks for one specifically for the shared view. The tests assert the properties we thought to test; a review is what finds the ones we did not.

**§40's twenty-one requirements, enumerated rather than assumed.** Nineteen are implemented: data minimisation, transport encryption, secret storage, MCP token hashing, the token and magic-link log bans, email redaction in logs, role-based admin, the audit log, rate limiting, `bodyLimit` and helmet and CORS on `core`, authenticated webhooks, account deletion, data export, backup, the restore procedure, and incident response. The host allowlist was missing and is now built. One is deliberately not:

- **Request size limits exist on `core` and not on `mcp`.** `apps/core` sets `bodyLimit` to 1 MiB; `apps/mcp` is a raw `node:http` server and sets nothing. The exposure is smaller than it looks — `authenticate` reads only the `Authorization` header, and both it and the host allowlist run and return before `transport.handleRequest` ever reads the body, so an unauthenticated caller cannot make this server buffer anything. What remains is an authenticated token holder sending an unbounded body, and a token holder is a named user who can be revoked. It is not built because `apps/mcp/src/main.ts` has no integration-test harness, so a limit added now could not be shown to leave real MCP traffic working, and a wrong limit on the demo surface fails in front of an audience. **Route this to the security review in blocker 11** rather than treating it as closed.

**Nothing has been sent through real Postmark, and the MCP demo has never run against a real client.** Both are tested against fakes, which proves the logic and proves nothing about the integration. Blockers 5 and 12 are asking about the integration.

**The legal text does not exist.** Three of the fourteen blockers are waiting on documents only Luma can produce. The engineering around them — versioning, acceptance history, the placeholder flag that blocks launch — is done and will hold whatever text arrives.

## How to use this document

Update it when a status changes, and be strict about the difference between *partial* and *done*. "Done" here means a test exists that would fail if the behaviour regressed. A mechanism that works but is not joined to the running system is *partial*, however complete it looks in isolation — that distinction is the whole point of the document.
