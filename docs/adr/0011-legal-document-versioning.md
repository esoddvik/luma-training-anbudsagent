# ADR-0011: Legal document versioning

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §18, §19, §20.1, §21, §37, §48, §49 (ADR 11), §51

## Context

Two legal documents govern the service. The privacy notice is Luma Training's existing one, referenced by URL (`LUMA_PRIVACY_POLICY_URL`) and reviewed before launch to confirm it actually covers tender alerting, profile criteria, email notifications, sharing links, MCP use, consent history, order data, attribution measurement, Postmark, Railway, Vercel, Doffin data, retention, deletion and processors (§18). The terms of use are new and must be created, approved and version-stored before public launch (§19, §51 blocker 2).

Both change over time. When they do, the question that matters is not "what do the terms say" but "which version did this specific user accept, and when". A URL alone cannot answer that, because the content behind it changes. Neither can a boolean `accepted_terms` column.

§19 requires version handling, acceptance history and launch blocking. §21 requires that consent events carry `policyVersion` and `termsVersion`. §20.1 distinguishes mandatory acceptance of terms and privacy acknowledgement from optional marketing consent, which is a separate thing entirely.

## Decision

Model legal documents as versioned records with an immutable acceptance history, in `packages/legal`.

**`legal_documents`** identifies the document: a stable key (`terms_of_use`, `privacy_policy`), a Norwegian display title, and its kind.

**`legal_document_versions`** holds each version: document id, version identifier, effective-from date, the content or a canonical URL plus a content hash, a summary of what changed, and the publication timestamp. **Versions are immutable.** Correcting a typo creates a new version.

**`user_legal_acceptances`** records that a specific user accepted a specific version at a specific time, with the source surface and, where available, a hashed IP and user agent. Insert-only, mirroring ADR-0009.

Rules:

1. **Current versions come from configuration:** `CURRENT_TERMS_VERSION`, `CURRENT_PRIVACY_POLICY_VERSION` and `CURRENT_MARKETING_CONSENT_TEXT_VERSION` (§48). Startup validation asserts each names an existing, published version row. A mismatch fails startup rather than silently recording acceptance of a version that does not exist.
2. **Acceptance is captured at the moment of the act,** with the version identifier that was actually rendered to the user, not the version that happens to be current when the row is written.
3. **Consent events carry the versions.** Every `consent_events` row records `policyVersion` and `termsVersion` (§21), so a marketing consent can be traced to the legal context it was given in.
4. **Terms and privacy acknowledgement are mandatory; marketing consent is not** (§20.1). They are stored separately and neither implies the other.
5. **A new terms version triggers re-acceptance.** Users with an acceptance of an older version see a re-acceptance prompt on next login. Tender alerting continues while re-acceptance is pending, unless legal review determines otherwise; this is the conservative reading of §3's rule that tender data is never withheld to force an action.
6. **The privacy URL is configured once.** `LUMA_PRIVACY_POLICY_URL` is read from `packages/config` and rendered by one component. §18 forbids hardcoding it in multiple places, and it must appear in registration, consent text, footer, account settings, email footer, MCP token creation, shared view, account deletion and ordering.
7. **Launch blocking is enforced in code.** A startup check refuses to boot in production if the terms document has no published, approved version, or if the mandatory coverage text from §43 is absent from the terms and landing page content. Placeholder legal text must not be presentable as final (§51 blocker 8).

## Consequences

### Positive

- "Which terms did this user accept" is answerable exactly, years later, including for users who accepted a version that has since been superseded.
- The immutable version table means the historical text is recoverable, not just its identifier.
- Startup validation converts a class of quiet configuration errors (a `CURRENT_TERMS_VERSION` typo) into an immediate, obvious failure.
- The launch-blocking check makes §51's blockers 2, 3 and 8 mechanical rather than a checklist someone has to remember.
- One configured privacy URL means a change to Luma's privacy notice location is a single environment change.

### Negative / trade-offs

- Every legal text change is a database operation plus an environment variable change plus a deployment. Deliberate friction: legal text changes should be deliberate.
- Re-acceptance prompts interrupt users. Mitigated by using them only for terms changes, not for privacy notice updates, which are acknowledged rather than accepted.
- The privacy notice lives at an external URL owned by Luma Training. We can store a hash of its content at the time of acceptance, but we do not control its immutability. This is recorded as an accepted limitation: the hash tells us whether the content has changed since, which is what matters for evidence.
- Storing the terms content in the database rather than in the repository means the text is not code-reviewed in a pull request. Mitigated by an admin change log in `admin_audit_events` and by version immutability.

## Alternatives considered

- **A boolean `accepted_terms` column.** Rejected: cannot answer which version, and is overwritten on re-acceptance.
- **Terms as Markdown files in the repository, version identified by git commit.** Attractive for reviewability, rejected because §19 requires an acceptance history joined to the version, and because a legal text change would then require a deployment by an engineer rather than a publication by an approver.
- **Storing only the URL and the acceptance timestamp.** Rejected: the content behind a URL changes, so the timestamp proves nothing about the text.
- **Writing our own privacy notice rather than referencing Luma's.** Rejected by §18. One organizational privacy notice, reviewed for this service's processing.

## Verification

- A test asserts `legal_document_versions` rows are never updated: attempting to modify a published version raises, and publishing a correction creates a new row while the original remains byte-identical.
- A test asserts `user_legal_acceptances` is insert-only and that accepting a second time creates a second row rather than replacing the first.
- A startup test asserts the process refuses to start when `CURRENT_TERMS_VERSION` or `CURRENT_PRIVACY_POLICY_VERSION` names a version that does not exist or is not published.
- A test asserts an acceptance records the version identifier that was rendered, by rendering version A, publishing version B mid-test, then submitting the acceptance, and asserting the stored version is A.
- A test asserts every `consent_events` row created through the signup flow carries non-null `policyVersion` and `termsVersion`.
- A test asserts a user whose latest acceptance is for a superseded terms version is prompted to re-accept on next login, and that their digest is still delivered while the prompt is pending.
- A grep-based test asserts the privacy policy URL literal appears in no component; every use resolves through `packages/config`.
- A rendering test asserts the privacy link is present on each of the nine surfaces listed in §18.
- A launch-gate test asserts that a production boot with an unpublished or placeholder terms version fails, and that the §43 coverage text ("Tjenesten dekker kunngjøringer publisert på Doffin...") is present on both the landing page and the terms page.
