# ADR-0014: Promotion ladder and regional routing as an editorial layer

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §0 (items 6, 7, 17), §8.5, §22, §23, §24, §42, §44, §49 (ADR 14), §52

## Context

Luma Training has four things to promote, at very different commitment levels: free professional content (articles, guides), Påfyll at 395 NOK per month, the NHO course and webinars, and the full-day course "Vinn flere anbud med AI" at 14 500 NOK, held physically in Oslo.

Two problems follow. First, sequencing. Showing a new user a 14 500 NOK course in their first digest is the behaviour of a service that wants something. Luma's brand is "praktisk og ærlig, null hype" (§42), and the trust contract (§3) makes the free service genuinely free. Second, geography. The full-day course is physical, in Oslo (§8.5). Promoting it to a contractor in Tromsø is not aggressive, it is simply useless, and useless promotion erodes attention for the promotion that is not.

The trap is obvious: both problems could be solved with personalization logic that reaches into user behaviour and tender data. Version 2 of the spec closes that door in advance (§23.2): routing is based on the profile's geography, not on IP or tracking, and it is editorial logic in the `EditorialRecommendation` layer that must never touch matching.

## Decision

Promotion selection is an **editorial layer**, structurally separate from matching (ADR-0006), driven by two declarative attributes on the recommendation itself.

**The ladder (§23.1)**, encoded as `ladderLevel: 1 | 2 | 3 | 4` on `EditorialRecommendation`:

1. Free professional content (article, guide, webinar). Default level for new users.
2. Påfyll. The main product in digest promotion, under the heading "Faglig påfyll fra Luma Training".
3. NHO course (hybrid, national) and webinar.
4. Full-day course (14 500 NOK, physical, Oslo), shown only after regional routing.

The ladder governs editorial choice and default rotation. It is explicitly **not an aggressiveness scale**: every level obeys the same placement and labelling rules in §23.4.

**Regional routing (§23.2)**, encoded as `regionScope: "national" | "oslo_region"`:

- A recommendation scoped `oslo_region` is shown only to users whose alert profile geography intersects the configured Oslo region list (`OSLO_REGION_CODES`, §48).
- Users outside the region see NHO course, webinar and Påfyll instead.
- Routing reads the profile's declared geography. It does not read IP, and it does not use tracking.

**Selection is a pure function** in the editorial module:

```
selectRecommendation(input: {
  placement: "digest_footer" | "tender_detail" | "empty_state" | "mcp_resource";
  profileGeography: string[];
  industryTemplateId?: string;
  ladderState: LadderState;
  now: Date;
}): EditorialRecommendation | null
```

It receives no match list, no tender scores and no attribution history. Returning `null` is valid and means no promotion block is rendered.

**Placement rules** are enforced in rendering, per §23.3 and §23.4: promotion appears only after tender content, in the digest footer, on the tender detail page, in empty states, and in the explicit Luma MCP resource. In the shared view only the single invitation block from §17 applies. Every block is visually separated and labelled as Luma content, paid offers are marked as paid, and the whole block disappears when `includeLumaPromotionsInTenderEmails` is false (§22) without any change to the tenders shown.

**Prohibitions from §23.5 are treated as testable invariants,** not guidance: no promotion before or between tenders, no hiding of deadlines or tender data behind promotion, no degraded matches for users who turn promotion off, no claim that a course is necessary, no relevance score changed by commercial value, no separate marketing campaign without consent, no MCP search tool auto-including sales text, no artificial scarcity or false urgency.

**Attribution flows out, never in.** Outgoing Luma links carry consistent UTM parameters (`utm_source=anbudsvarsling`, medium by surface, campaign by recommendation) and impressions and clicks are recorded in `editorial_impressions` and `editorial_clicks` (§37). Per §44.3, this data reports performance and never feeds back into matching or ranking. The one permitted feedback is ladder rotation, which changes which recommendation appears in the footer and nothing else.

## Consequences

### Positive

- New users meet free content first, which is what the trust contract implies in practice.
- Recommendations are data, editable in admin without a deploy (§45), so campaign changes are an editorial act rather than an engineering ticket.
- Regional routing based on declared profile geography is both more accurate than IP inference and better for privacy, and it needs no tracking infrastructure.
- Because selection is a pure function of placement, geography, industry template, ladder state and time, its behaviour is fully testable and its reasoning is auditable.
- Turning promotion off is a genuine off switch with a provable no-op on tender content.

### Negative / trade-offs

- Ladder progression is coarse. Without behavioural signals, it is driven by account age, placement and rotation rather than by demonstrated interest. Deliberate: behavioural personalization would require reading interaction data, which is the first step toward the coupling ADR-0006 forbids.
- The Oslo region list is a configured list of codes and will be wrong at the margins, for example a user in Østfold who would happily travel. Accepted; the list is configurable and can be tuned from data.
- A user whose profile covers all of Norway matches the Oslo scope, so a national contractor may see the full-day course. Acceptable, and arguably correct.
- Recommendation relevance cannot use match reasons, so a tender about ventilation cannot pull a ventilation-specific guide. `relevanceTags` matched against the industry template is the deliberate, weaker substitute.

## Alternatives considered

- **Behavioural targeting from click and open history.** Rejected: creates a read path from engagement data into promotion selection, and from there the argument for reading it into ranking becomes a short one. §44.3 forecloses it.
- **Showing the highest-value product to everyone.** Rejected by §23.1 and §42. It is exactly the hype posture the brand is defined against, and it would raise the promotion opt-out rate, which §44.3 tracks as a trust metric.
- **IP-based geolocation for regional routing.** Rejected by §23.2 explicitly. Less accurate, and it introduces tracking into a service that otherwise does not need it.
- **Letting the editorial layer read match reasons for better topical fit.** Rejected. See ADR-0006, alternatives.
- **A single recommendation slot with manual scheduling and no ladder.** Rejected: it would work, but it puts the sequencing rule in a human's head instead of in the data, and it cannot be tested.

## Verification

- An import-graph test asserts the editorial module has no import edge into `packages/matching`, and that `selectRecommendation`'s input type contains no field carrying match, score or attribution data.
- A purity test asserts `selectRecommendation` performs no I/O and returns identical output for identical input across repeated calls with a fixed `now`.
- A regional-routing test asserts a recommendation with `regionScope: "oslo_region"` is never returned for a profile whose geography does not intersect `OSLO_REGION_CODES`, across a table of profile geographies covering every Norwegian region code.
- A ladder test asserts a newly created user's first digest selects a level 1 recommendation, and that level 4 is unreachable for a non-Oslo profile regardless of ladder state.
- An ordering test asserts the rendered digest places the promotion block after every tender card and after the planned-procurement section, with no promotion markup between two cards.
- A parity test asserts two otherwise identical users, one with `includeLumaPromotionsInTenderEmails` true and one false, receive the identical ordered list of tenders (§23.5).
- A labelling test asserts every rendered promotion block carries a "Fra Luma Training" style heading and the §43 disclosure text, and that any recommendation whose `marketingCategory` is `course`, `nho_course` or `paid_newsletter` is marked as paid.
- A shared-view test asserts `selectRecommendation` is never called for the shared view and that its rendered output contains exactly one invitation block.
- An MCP test asserts `search_tenders` and `find_matching_tenders` responses contain no promotional text, and that Luma content is reachable only through `get_luma_learning_resource` and the `luma://` resources.
- A UTM test asserts every outgoing Luma link carries `utm_source=anbudsvarsling` plus a medium matching the surface and a campaign matching the recommendation id.
- A copy test scans recommendation content for scarcity and urgency patterns (countdowns, "kun i dag", "siste plasser", "må", "garantert") and fails on a match, enforcing §23.5 and §42.
