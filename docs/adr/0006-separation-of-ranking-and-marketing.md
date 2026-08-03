# ADR-0006: Separation of ranking and marketing

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §1, §2, §3, §4.1, §14, §23, §24, §37, §44, §49 (ADR 6), §53

## Context

This service has two jobs (§1): solve the supplier's problem, and be a measurable marketing surface for Luma Training. The specification states that the order is absolute and that the two jobs must never be mixed in the implementation.

The pressure is structural, not hypothetical. Attribution data will exist. It will show which users click Påfyll, which digests convert to course seats, and which recommendation placements perform. At some point someone will have a reasonable-sounding idea: surface tenders that correlate with users who bought a course, or nudge high-value prospects up the list. Spec §3 forbids this, §23.5 forbids it again, and §44.3 forbids it a third time: attribution data must never be an input to matching, ranking or recommendation selection beyond ladder-level rotation.

The customer-facing trust text (§43) promises this explicitly: "Kurs, annonser eller kommersielle hensyn påvirker aldri hvilke anbud du får se." An architecture that merely intends to honour that promise is not enough. The separation has to be structurally impossible to violate by accident.

## Decision

Enforce the separation as a **module boundary with no import edge**, not as a code review convention.

1. **Three isolated packages.**
   - `packages/matching`: pure ranking (ADR-0004).
   - `packages/attribution`: attribution events, UTM construction, reporting.
   - The editorial recommendation module (in `packages/domain`, or its own package): promotion ladder, regional routing, `EditorialRecommendation` selection (§24).

2. **`packages/matching` may not import from `packages/attribution` or from the editorial module.** Not for types, not for constants, not for utilities. The dependency graph is one-directional: presentation layers may import all three; matching imports neither of the others.

3. **`MatchResult` contains no commercial field.** Its shape is fixed by §14: tenderId, alertProfileId, score, confidence, included, reasons, exclusions, matchingVersion. There is no `promotedBy`, no `campaignId`, no `commercialValue`, no `sponsored` flag. Adding one is a schema change that fails the shape test.

4. **Ordering is computed before promotion is selected.** In the digest pipeline, matches are ranked and grouped, and only then does the editorial layer choose a recommendation for the footer. The recommendation selection function receives the profile's geography, the industry template id, the placement and the ladder state. It does not receive the match list, and it cannot reorder anything.

5. **Attribution is a sink, not a source.** `attribution_events` is written to by the notification, sharing and order flows. Nothing in the matching or ingest path reads it. Per §37, `attribution_events` has no foreign keys into the match tables beyond `tenderId` for reporting.

6. **Presentation rules are structural too.** Promotion appears after tender content, visually separated, labelled as Luma content, and is switchable off without affecting which tenders are sent (§23.4). The shared view carries only the single quiet invitation block and no other promotion (§17).

7. **The one permitted commercial influence is ladder rotation.** Which recommendation is shown, chosen by ladder level and region scope, is an editorial decision on the promotion block. It has no effect on the tender list.

## Consequences

### Positive

- The promise in §43 becomes a property of the build rather than a claim in a document. A pull request that violates it fails CI.
- Reviewers get a bright line. "Does this add an import edge into `packages/matching`?" is answerable in seconds; "does this subtly bias ranking?" is not.
- Attribution can be instrumented as richly as the business wants (§44) without any risk of leaking into ranking, because the leak path does not exist.
- The trust metrics in §44.3 (share turning off promotion, unsubscribe rate, complaints) stay interpretable, because promotion changes never confound the tender content.

### Negative / trade-offs

- Some genuinely harmless personalization is foreclosed. Recommendation selection cannot use behavioural signals derived from tender interaction, only profile geography, industry template, placement and ladder level. Accepted: the cost of a blurred line is higher than the value of a better-targeted footer.
- Two rendering paths need the same tender data assembled twice in slightly different shapes (once for ranking, once for the email template with its promotion slot). Mild duplication, deliberately kept.
- Commercial reporting is coarser than a fully joined model would allow. §44.3 says these numbers are reported and never steer product logic, so coarse is acceptable.

## Alternatives considered

- **A single "relevance" service with a commercial weight parameter defaulted to zero.** Rejected: a parameter that exists will eventually be set. The safe default is not having the parameter.
- **Enforcing separation by code review and a written rule.** Rejected: unenforceable over time and across contributors, and it fails silently.
- **Sponsored placements inside the tender list, clearly labelled.** Rejected outright by §7.3 ("skjulte sponsede rangeringer") and §23.5.
- **Letting the recommendation engine read match reasons to pick a more relevant article.** Tempting and rejected. It creates a read edge from the editorial layer into match data, which is the first half of a feedback loop. Recommendation relevance uses `relevanceTags` against the profile instead (§24).

## Verification

- **Import-graph test:** an automated test asserts that `packages/matching` has no import edge, direct or transitive, to `packages/attribution` or to the editorial recommendation module. It walks the resolved dependency graph and the source `import` statements, and fails on any edge.
- **Shape test:** a test asserts the runtime keys of a `MatchResult` are exactly the eight fields in §14, and a type-level test asserts no additional commercial field is assignable.
- **Ordering-invariance test:** the digest pipeline is run twice for the same user and match set, once with promotion enabled and once disabled, and the test asserts the ordered list of tender ids is identical in both runs.
- **Attribution-blindness test:** a fixture user is given a dense `attribution_events` history (course clicks, Påfyll activation, webinar registration) and a control user is given none. With identical profiles and the same tender corpus, the test asserts identical `MatchResult` values for both.
- **Schema test:** a migration test asserts `attribution_events` has no foreign key into `tender_matches` or `tender_match_reasons`.
- **Rendering-order test:** an email snapshot test asserts the promotion block appears after every tender card and after the planned-procurement section, and that no promotion markup appears between two tender cards.
- **Shared-view test:** a test asserts the rendered shared view contains exactly one invitation block and no `EditorialRecommendation` content.
- **Off-switch test:** a test asserts a user with `includeLumaPromotionsInTenderEmails = false` receives the same tenders, in the same order, as an otherwise identical user with it enabled (§23.5, "gi dårligere treff til brukere som slår av promotering").
