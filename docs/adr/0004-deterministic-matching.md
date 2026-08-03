# ADR-0004: Deterministic matching

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §3, §4.2, §4.3, §11, §14, §41, §49 (ADR 4), §52

## Context

The product's core promise is not "we find you tenders". It is "we can tell you exactly why this tender is in your inbox" (§4.2). Spec §3 makes explainability part of the trust contract, §4.3 forbids presenting a score as a win probability, and §41 states plainly that the MVP must work with no AI model at all: the user's own AI tool, reached over MCP, is the intelligence in the system, and the service supplies structured, traceable data.

There is a real temptation to reach for embeddings or an LLM relevance judge. It would be quicker to get something that feels smart. It would also be unexplainable, non-reproducible, and impossible to defend when a user asks why a tender they cared about did not appear. For a free service whose entire commercial logic rests on being trusted, that is the wrong trade.

## Decision

Matching is a **pure, versioned, deterministic function** implemented in `packages/matching`:

```
match(tender: Tender, profile: AlertProfile, weights: MatchWeights): MatchResult
```

Properties:

1. **Pure.** No I/O, no clock reads, no randomness, no database access. All inputs are arguments. The caller loads data; the function decides.
2. **Deterministic.** The same `matchingVersion`, the same tender and the same profile always produce byte-identical `MatchResult`, including the order of `reasons` and `exclusions`.
3. **Versioned.** `matchingVersion` is a constant in the package and is stored on every `tender_matches` row. The unique constraint is `(tender_id, alert_profile_id, matching_version)` (§37), so a version bump produces new rows rather than mutating history, and old explanations remain readable.
4. **Explaining, not scoring.** Every point that contributes to the score produces a `reason` with a type from the fixed list in §14, a customer-facing Norwegian label, a numeric contribution and the concrete `evidence` (the CPV code that matched, the keyword occurrence, the region). A score with no reasons is a bug, not a low match.
5. **Exclusions override inclusions** (§11). Hard exclusions short-circuit to `included: false` and are recorded with evidence so the user can see why something was filtered out.
6. **Configurable weights, fixed defaults.** Starting weights follow §14 (CPV 35, keywords 25, geography 15, buyer 10, value 5, type and procedure 5, deadline 5). Weights are data, passed in, not constants scattered through the code.
7. **Planned procurements are first-class.** For `noticeCategory = "planned"` the `notice_type` reason carries the text "Dette er en planlagt anskaffelse. Konkurransen er ikke publisert ennå." The deadline component is skipped without penalty, because planned notices have no deadline.
8. **No commercial input.** See ADR-0006. Course clicks, Påfyll clicks, webinar clicks and attribution data are not arguments to this function and cannot become arguments.
9. **Feedback never mutates a profile automatically** (§15). Relevance feedback produces suggestions that require the user's approval.

Norwegian text handling is part of the determinism contract: case-insensitive comparison, normalization of æ, ø and å, exact-word and phrase matching, and CPV hierarchy matching where a profile's parent code matches a tender's child code.

## Consequences

### Positive

- Every match is reproducible from stored data. Support can answer "why did I get this" exactly, months later.
- The engine is testable as a table of pure input/output cases with no fixtures, no database and no mocks.
- Explanations are a by-product of the algorithm rather than a rationalization generated after the fact. They cannot drift from the actual scoring.
- Because `matchingVersion` is on every row, a weight change can be evaluated by running the new version alongside the old on the same corpus before switching.
- Satisfies §52 criterion 18: the MVP needs no AI model.

### Negative / trade-offs

- Rule-based matching handles synonyms and paraphrase poorly. A tender described as "rehabilitering av ventilasjonsanlegg" will not match a profile whose keyword is only "VVS" unless someone put both in. The industry templates (§11.2) exist partly to mitigate this by shipping curated keyword sets.
- Recall is bounded by the quality of the user's own profile. This is honest but it is also a real limitation, and the relevance-feedback loop (§15) is how it improves.
- Weight tuning is manual and needs the primary quality metric from §44.3 (share of user-rated matches marked relevant) to be instrumented before it can be done responsibly.
- Adding AI-assisted interpretation later means adding a clearly separated, clearly labelled layer on top (§4.2 distinguishes rule-based matching from AI-generated interpretation), not modifying this function.

## Alternatives considered

- **Embedding similarity as the primary ranker.** Rejected: cannot produce the reason list §4.2 requires, and a cosine distance is not an explanation.
- **LLM relevance judge per tender/profile pair.** Rejected: non-deterministic, unreproducible across model versions, costly per tender at daily ingest volume, and directly at odds with §41's requirement that the MVP work without a model.
- **Hybrid, deterministic filter plus LLM re-rank.** Deferred. It could be added later as a labelled interpretation layer, but the ordering the user sees in the MVP is the deterministic one.
- **Storing only the score and recomputing reasons on demand.** Rejected: recomputation against a later code version would produce explanations that do not correspond to the email the user actually received.

## Verification

- A test asserts `packages/matching` has zero runtime dependencies on `@luma/db`, `@luma/doffin`, `@luma/attribution`, `@luma/email` or any HTTP client, by inspecting its `package.json` dependency list and by a source scan for `import` statements crossing those boundaries.
- A determinism test runs `match()` 100 times over a fixture corpus and asserts deep equality of every `MatchResult`, including array ordering.
- A snapshot test over a checked-in corpus of tender/profile pairs pins the exact score, reason list and exclusion list per `matchingVersion`. Changing behaviour without bumping the version fails the build.
- A test asserts that no `MatchResult` with `score > 0` has an empty `reasons` array.
- A test asserts every hard exclusion in §14 produces `included: false` with a populated `exclusions` entry: excluded CPV, excluded keyword, excluded buyer, outside mandatory geography, outside the value range, closed/cancelled/expired, `planned` when `includePlannedProcurements` is false, and `award` in the MVP.
- A test asserts a planned notice with no deadline receives no deadline penalty, and that its `notice_type` reason carries the exact Norwegian sentence from §14.
- A test asserts the function signature accepts no clock, no random source and no network client, and that calling it with a frozen system clock and a different frozen clock produces identical output.
- A test asserts that submitting relevance feedback leaves the `alert_profiles` row byte-identical.
