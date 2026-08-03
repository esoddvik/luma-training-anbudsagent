# ADR-0005: Postmark message streams

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §22, §25, §26, §27, §40, §49 (ADR 5), §51

## Context

The service sends three categorically different kinds of email:

1. Account-critical mail: magic login links, security notices, order confirmations, account deletion confirmations. The user must receive these; there is no meaningful opt-out short of deleting the account.
2. Tender alerts: immediate alerts, daily and weekly digests, material-change notices. The user opted into these and can pause or stop them. These may carry the clearly separated Luma promotion block (§23).
3. Luma marketing: standalone course campaigns, Påfyll campaigns, webinars. These require valid marketing consent (§20.2, §21).

Mixing these on one stream creates two failure modes that both damage the product. First, a spam complaint on a marketing campaign suppresses the recipient's address, and the next magic login link silently never arrives. The user is then locked out of a service they never intended to leave. Second, an unsubscribe from marketing that also stops tender alerts breaks §21's explicit rule that withdrawal of marketing consent must not disable tender alerting.

Postmark's message streams give separate reputations, separate suppression lists and separate webhook configuration, which maps exactly onto this problem.

## Decision

Use **three Postmark message streams**, one per category, configured through environment variables so a stream can be swapped without a code change:

| Stream | Env var | Content | Consent basis |
| --- | --- | --- | --- |
| `transactional` | `POSTMARK_TRANSACTIONAL_STREAM` | Magic links, security notices, account confirmation, order request received, paid access activated, account deletion | Contractual / account-critical |
| `tender-notifications` | `POSTMARK_TENDER_NOTIFICATION_STREAM` | Immediate alerts, daily and weekly digests, material-change notices. May contain the separated Luma promotion block | Service opt-in (the user created an alert profile) |
| `luma-marketing` | `POSTMARK_MARKETING_STREAM` | Standalone course, Påfyll and webinar campaigns | Explicit marketing consent (§20.2) |

Rules:

- `packages/email` owns the mapping from template name to stream. A caller names a template; it cannot name a stream. There is no code path that lets a marketing template be sent on the transactional stream or vice versa.
- Every template in §25 has a fixed stream assignment declared in one table in code.
- Before any send on `luma-marketing`, the current consent status is derived from `consent_events` (ADR-0009) and checked. No consent, no send.
- Suppression is scoped per stream. A marketing unsubscribe suppresses on `luma-marketing` only. A hard bounce on `transactional` is treated as an account-level problem and surfaced in admin (§45), not silently swallowed.
- Postmark webhooks are received per stream at `/api/v1/postmark/webhooks/:stream`, authenticated with basic auth (`POSTMARK_WEBHOOK_USERNAME` / `POSTMARK_WEBHOOK_PASSWORD`), answered fast, and handed to the `postmark.webhook.process` queue job for the actual work (§27, §38). Processing is idempotent, keyed on Postmark `MessageID` plus event type.
- Unsubscribing from tender alerts does not remove marketing consent, and withdrawing marketing consent does not stop tender alerts. The user can choose to do both (§21).
- Turning off the promotion block (`includeLumaPromotionsInTenderEmails`, §22) changes the content of `tender-notifications` mail. It does not change the stream, and it does not change which tenders are sent (§23.5).

## Consequences

### Positive

- A marketing complaint cannot lock a user out of their account. This is the single most valuable property of the split.
- Deliverability of magic links is protected by a stream whose reputation is not exposed to campaign sends.
- Per-stream metrics in Postmark map directly onto the trust metrics in §44.3: unsubscribe rate, spam complaints and bounce rate can be read per category rather than as one blurred number.
- The consent gate has exactly one place to live, on the boundary of one stream.

### Negative / trade-offs

- Three streams means three sets of webhook configuration, three suppression lists to check when debugging "the user says they got nothing", and three sender signatures to keep verified.
- A user can be suppressed on one stream and not another, which is correct but is a support-facing subtlety. Admin (§45) must show delivery status per stream, not per user.
- Reputation on `luma-marketing` is built from scratch and is thinner than a combined stream would be. This is the intended cost.

## Alternatives considered

- **One stream with a category header and internal filtering.** Rejected: Postmark suppression is per stream, so a marketing complaint would suppress transactional mail. This is the failure this ADR exists to prevent.
- **Two streams (transactional plus everything else).** Rejected: tender alerts and marketing campaigns have different legal bases, and blending them makes the consent boundary a runtime condition rather than an infrastructure one.
- **A different provider per category.** Rejected: multiplies operational surface for no gain; §27 already specifies Postmark.
- **Sending marketing from an external campaign tool.** Rejected for the MVP: consent state lives in this system's `consent_events`, and exporting it to a second system creates a synchronization problem with legal consequences.

## Verification

- A test enumerates every template name in §25 and asserts each maps to exactly one stream, and that the mapping table is exhaustive (a new template with no stream fails the test).
- A test asserts the public send API of `packages/email` accepts a template identifier and does not accept a stream identifier from the caller.
- A test asserts that a marketing send for a user whose latest `marketing_email` consent event is `withdrawn` throws and performs no Postmark call, using a Postmark test double that records calls.
- A test asserts that withdrawing marketing consent leaves `tenderAlertsEnabled` unchanged, and that disabling tender alerts leaves the derived marketing consent status unchanged.
- A test asserts a suppression event on `luma-marketing` does not block a subsequent `transactional` send to the same address.
- A webhook idempotency test delivers the same Postmark payload twice and asserts exactly one `email_events` row.
- A test asserts the webhook endpoint returns 401 without valid basic auth credentials.
- A test asserts a digest rendered with `includeLumaPromotionsInTenderEmails = false` contains no promotion block and the identical set of tender cards as the same digest rendered with it enabled.
