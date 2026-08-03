# ADR-0009: Append-only consent

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §3, §20, §21, §27, §37, §44.1, §49 (ADR 9), §51, §52

## Context

Under GDPR, consent is not a current state. It is a claim about a past event that the controller must be able to demonstrate: who consented, to what exact wording, when, through which channel, and under which version of the privacy policy and terms. A boolean column on the user row can answer none of those questions. It answers "does this person want marketing right now", overwrites the previous answer, and destroys the evidence.

Spec §21 is unambiguous: consent is stored as append-only events, previous events are retained, withdrawal is a new event, and current status is derived from the latest valid event. §20.2 requires that marketing consent is voluntary, unchecked by default, not required for the service, withdrawable, and stored with source, date and the exact text the user agreed to. §51 makes working consent recording and withdrawal a launch blocker.

## Decision

Model consent as an immutable event log.

**`consent_events`** carries the shape from §21: id, userId, consentType (`marketing_email` | `privacy_acknowledgement` | `terms_acceptance`), status (`granted` | `withdrawn` | `accepted` | `superseded`), source (`signup` | `account_settings` | `checkout` | `invoice_request` | `course_registration` | `newsletter_registration` | `admin_recorded` | `imported` | `api`), sourceDetail, policyVersion, termsVersion, consentTextVersion, occurredAt, ipAddressHash, userAgent, createdAt.

Supporting tables: `consent_text_versions`, `legal_documents`, `legal_document_versions`, `user_legal_acceptances` (see ADR-0011).

Rules:

1. **Insert only.** No `UPDATE` and no `DELETE` against `consent_events` from application code. Withdrawal inserts a `withdrawn` row. Re-granting inserts a new `granted` row. A superseded consent text produces a `superseded` row rather than an edit.
2. **Current status is derived,** by a single function in `packages/consent` that reads the latest event for a `(userId, consentType)` pair ordered by `occurredAt`. No cached boolean is the source of truth. If a denormalized column is ever added for query performance, it is a projection, rebuilt from events, and never written directly.
3. **The exact text is captured by reference.** `consentTextVersion` points at a row in `consent_text_versions` holding the literal Norwegian wording the user saw. Changing the wording creates a new version; it never edits an existing one.
4. **Provenance is mandatory.** Every event has a `source`. Admin-recorded and imported consent additionally require `sourceDetail` documenting the basis; §21 states admin may not create consent without documented grounds. Admin changes are also written to `admin_audit_events`.
5. **Withdrawal propagates to Postmark** (§21, ADR-0005). The `consent.sync` job (§38) reconciles suppression state on the `luma-marketing` stream.
6. **Withdrawal does not stop tender alerts,** and unsubscribing from tender alerts does not remove marketing consent (§21). These are separate switches with separate storage.
7. **`includeLumaPromotionsInTenderEmails` is not consent.** It is a content preference on `notification_preferences` (§22) and lives outside this log.
8. **Consent history survives account deletion** to the extent the law requires the controller to demonstrate past consent, and is otherwise anonymized by severing the user reference rather than deleting rows. §37 states consent history must not be overwritten; the retention decision for deleted accounts is recorded as an open question below.

## Consequences

### Positive

- The controller can answer a supervisory authority's question with a row, including the literal text shown and the policy version in force.
- Bugs become recoverable. If a UI defect grants consent incorrectly, the log shows exactly which users, from which source, in which window.
- The primary trust metrics in §44.3 (marketing consent granted and withdrawn, with source and text version) come out of the same log rather than needing separate analytics instrumentation.
- Separating consent from notification preferences makes §21's non-interference rules expressible as two independent reads rather than as conditional logic over one flag.

### Negative / trade-offs

- Reading current status is a query with an ordering, not a column read. Mitigated by an index on `(user_id, consent_type, occurred_at DESC)`.
- The table grows monotonically. At this user volume that is negligible, and the alternative is losing the evidence.
- Every consent-touching code path must go through `packages/consent`. A direct insert from elsewhere would bypass validation of `consentTextVersion`. Enforced by the import-boundary test below.
- Import of historical consent from other Luma systems needs a documented basis per record, which is administrative work that cannot be automated away.

## Alternatives considered

- **Boolean `marketing_consent` on `users`.** Rejected by §21. It cannot demonstrate consent, and it silently destroys prior state.
- **Boolean plus a generic audit log.** Rejected: two sources of truth that will disagree, and the audit log is not authoritative, so disputes are unresolvable.
- **Event sourcing the entire domain.** Rejected as over-application. Consent has a legal demonstrability requirement that tenders and profiles do not.
- **Storing consent only in Postmark's subscription state.** Rejected: Postmark records a subscription, not the wording consented to or the policy version, and it is a processor rather than the controller's record.

## Open question

Whether `consent_events` rows for a deleted account are retained with the user reference severed, or retained intact for a defined period, depends on Luma Training's retention policy and on legal review of the privacy notice (§18, §51 blocker 1). Decision criteria: the shortest retention that still lets Luma demonstrate lawful basis for marketing sent before deletion. Until that review concludes, deletion severs the user reference and retains the event, which is the more conservative option and is reversible in the direction of shorter retention.

## Verification

- **No-update test:** a test asserts consent rows are never `UPDATE`d. Withdrawal inserts a new event, and current status is derived from the latest event. It grants, withdraws and re-grants, then asserts three rows exist with distinct `occurredAt` values and that the first row's every column is byte-identical to what it was at insert.
- A database-level guard reinforces it: a trigger or a revoked `UPDATE`/`DELETE` grant on `consent_events` for the application role, with a test that an attempted update raises.
- A test asserts the derived-status function returns `granted` only when the latest event for that `(userId, consentType)` is `granted`, including the sequence grant, withdraw, grant.
- A test asserts every insert path requires a non-null `consentTextVersion` resolving to an existing `consent_text_versions` row, and that an unknown version is rejected.
- A test asserts an `admin_recorded` or `imported` event without `sourceDetail` is rejected, and that a successful admin insert also writes an `admin_audit_events` row.
- A test asserts marketing consent defaults to absent: a user completing signup without ticking the box has no `marketing_email` event with status `granted`.
- A non-interference test asserts withdrawing marketing consent leaves `notification_preferences.tenderAlertsEnabled` true and that a subsequent digest is still sent; and that disabling tender alerts creates no consent event.
- An import-boundary test asserts no module outside `packages/consent` writes to `consent_events`.
- A test asserts withdrawal enqueues `consent.sync` and that the job suppresses the address on the `luma-marketing` stream only.
