# ADR-0007: Source-neutral tender adapter

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §1, §5 item 3, §7.2, §12, §13, §46, §48, §49 (ADR 7)

## Context

Doffin is the only data source in the MVP (§5 item 3). TED, covering Nordic and European notices, is an explicitly listed post-MVP item (§7.2) and §12 requires that the adapter interface stay source-neutral so a future `TedApiAdapter` can implement the same contract.

There is also a harder constraint. Spec §1 is emphatic: when details of the Doffin API are missing, create a clear adapter interface, use realistic fixture data, document the assumption, and **do not invent API fields**. §53 restates it as a definition-of-done item. This matters because Doffin's response shape is not fully known to us at the time of writing, and the cost of guessing is a normalization layer built on fiction that must be torn out when real data arrives.

If Doffin's field names leak into the domain model, the database schema, the matching engine and the email templates, then adding TED later is not an adapter change, it is a rewrite.

## Decision

Put every source behind `TenderSourceAdapter`, defined in `packages/doffin` (the package keeps its spec name, but the interface it exports is source-neutral):

```typescript
interface TenderSourceAdapter {
  fetchNotices(input: {
    modifiedAfter?: Date;
    cursor?: string;
    pageSize?: number;
  }): Promise<{ notices: SourceTenderNotice[]; nextCursor?: string }>;

  fetchNoticeById(id: string): Promise<SourceTenderNotice | null>;
}
```

Two implementations ship in the MVP: `DoffinApiAdapter` and `FixtureTenderSourceAdapter`.

Rules:

1. **The adapter is the only place that knows source field names.** Everything downstream consumes the normalized `Tender` model from §13, which uses our vocabulary: `sourceId`, `noticeId`, `noticeCategory`, `buyerName`, `cpvCodes`, `regions`. A grep for a Doffin-specific field name outside `packages/doffin` should return nothing.
2. **`source` is a discriminator on the model, not a branch in the pipeline.** `Tender.source` is `"doffin"` today; adding `"ted"` widens a union. Normalization, change detection, matching, digest rendering and MCP tools stay unchanged.
3. **The raw payload is preserved verbatim** in `rawPayload`, with `sourcePayloadHash` for change detection and `sourceRevision` where the source provides one. This is what makes phase 8 possible without re-ingest (§13): award notices are ingested and stored in the MVP even though they are not exposed as a product surface.
4. **Response parsing is Zod-validated at the adapter boundary.** Unknown fields are preserved into `rawPayload` and ignored by the normalizer. A field the schema requires and the API omits is a loud parse failure recorded in `ingestion_errors`, not a silent `undefined`.
5. **No invented fields.** Where the real Doffin response shape is not yet confirmed, the fixture adapter is used and the assumption is written down in the adapter's own documentation. Contract tests use sanitized fixtures derived from real responses (§46), including prior-information notices, intention notices and award notices.
6. **Credentials.** Doffin is fronted by an Azure API Management style subscription key. The environment variable is `DOFFIN_SUBSCRIPTION_KEY`, replacing the spec's generic `DOFFIN_API_KEY` (§48). Only the Doffin variables actually needed are defined; `DOFFIN_API_CLIENT_ID` and `DOFFIN_API_CLIENT_SECRET` are not introduced unless a real OAuth flow turns out to be required.
7. **The sync job is source-agnostic.** It follows the eleven steps in §12 (read checkpoint, overlapping time window, fetch changed notices, normalize, idempotent upsert, record revision, detect new and materially changed records, enqueue match jobs, record metrics, advance checkpoint only after successful persistence, exit cleanly) and holds no Doffin-specific logic. Checkpoints are per source, so a TED checkpoint is a new row, not a new code path.

## Consequences

### Positive

- Adding TED later means writing one class and one set of fixtures. The domain, database, matching and email layers do not move.
- The fixture adapter makes the whole pipeline testable and developable with no Doffin credentials, which unblocks phases 1 through 4 regardless of API access timing.
- Storing `rawPayload` means a normalization mistake is recoverable by reprocessing rather than by re-ingesting from the source.
- Zod at the boundary turns an upstream shape change into a clear, attributable error instead of nulls propagating into digests.

### Negative / trade-offs

- The normalized model is a lowest-common-denominator view. Source-specific richness that does not fit §13 lives only in `rawPayload` and is not queryable through the normal path. Accepted: `rawPayload` is `jsonb` and can be indexed later if a specific need appears.
- Two adapters means the fixture adapter can drift from the real one. Mitigation: contract tests run the same assertions against both, and fixtures are sanitized captures of real responses rather than hand-written objects.
- `rawPayload` storage grows with the corpus. Bounded and acceptable; §37 requires only that raw payloads contain no user data.
- Region and municipality codes are Norwegian. A TED adapter would need a mapping layer that does not exist yet. That is a known future cost, recorded here rather than solved now.

## Alternatives considered

- **Call the Doffin API directly from the sync job.** Rejected by §12 and by the TED requirement in §7.2. It would also make testing depend on live credentials.
- **Store Doffin's shape as the canonical model and normalize at read time.** Rejected: pushes source coupling into every consumer, including the MCP tools and email templates, and makes a second source impossible without a migration.
- **Model the union of Doffin and TED fields now.** Rejected: we would be inventing TED fields, which is the same error §1 forbids for Doffin, just displaced.
- **Skip `rawPayload` to save space.** Rejected: it is the precondition for phase 8 being buildable without re-ingest (§13) and for reprocessing after a normalization fix.

## Verification

- A test asserts `packages/domain`, `packages/matching`, `packages/email` and `packages/mcp-tools` contain no occurrence of a Doffin-specific field name; the list of forbidden identifiers lives beside the adapter and is updated when the real response shape is confirmed.
- The full contract test suite runs against both `DoffinApiAdapter` (with recorded, sanitized HTTP fixtures) and `FixtureTenderSourceAdapter`, asserting identical normalized output for the same input payload.
- A test asserts `noticeCategory` derivation is exhaustive over the notice types present in the fixture corpus, with prior-information and intention notices mapping to `planned`, award notices to `award`, and an unrecognized type mapping to `other` while emitting a warning.
- An idempotency test ingests the same fixture batch twice and asserts unchanged row counts, unchanged `sourcePayloadHash` values, no new `tender_revisions` rows and no new match jobs.
- A failure test injects a partial failure mid-batch and asserts the `ingestion_checkpoints` row is unchanged and an `ingestion_errors` row exists.
- A schema test asserts `Tender.source` is a union type and that no `switch` on it exists outside `packages/doffin`.
- A test asserts every award-notice fixture round-trips its full source payload into `rawPayload` without field loss.
- An environment validation test asserts `DOFFIN_SUBSCRIPTION_KEY` is required when `DOFFIN_API_BASE_URL` is set, and that no code path reads `DOFFIN_API_KEY`.
