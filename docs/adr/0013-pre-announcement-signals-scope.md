# ADR-0013: Pre-announcement signals limited to Doffin notice types

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §0 (items 3, 13, 15), §5.4, §7.2, §7.3, §13, §14, §50 (phase 8), §49 (ADR 13)

## Context

The strongest thing this service can offer a supplier is time. Finding out about a competition on the day it is published puts you in the same position as everyone else. Finding out three months earlier is a different product.

There are three plausible sources of early signal, and they are not equally tractable.

1. **Doffin's own forward-looking notice types.** Prior information notices and intention notices are published on Doffin, arrive in the same data stream we already ingest, are structured, and are attributable to a named buyer. Version 2 of the spec promotes these from an invisible filter value to a visible product category in the dashboard and email (§0 item 3).
2. **Framework agreement expiry.** Award notices contain, where the buyer fills them in, the supplier and the contract duration. A framework awarded for four years in 2023 implies a re-competition around 2027. This is derived from data we already ingest and store (§13 requires award notices to be ingested and their raw payload preserved so phase 8 can be built without re-ingest).
3. **Municipal decision signals.** Council meeting minutes, budgets and investment plans. These genuinely predict procurement earlier than anything on Doffin. They are also unstructured, published in dozens of incompatible formats across hundreds of municipalities, and require editorial work to interpret.

§5.4 classifies municipal signals as a structural limitation, not a roadmap item, on the grounds that they require separate data collection and editorial work that lies outside a free service.

## Decision

**MVP: pre-announcement signal comes exclusively from Doffin notice types.**

`noticeCategory` is derived deterministically from the notice type (§13):

- `planned`: prior information notices and intention notices. Displayed as "Planlagt anskaffelse" on every surface, in its own clearly marked dashboard tab and digest section, with the match reason text "Dette er en planlagt anskaffelse. Konkurransen er ikke publisert ennå." (§14). Planned notices have no deadline, so the deadline component is skipped without penalty. Profiles include them by default (`includePlannedProcurements = true`).
- `competition`: active competitions.
- `award`: award notices. Ingested and stored in the MVP because they arrive in the same stream, but hard-excluded from matching and not exposed as a product surface until phase 8. The raw payload, including supplier name and contract duration where present, is preserved.
- `other`: everything else.

Where possible, a planned procurement that later becomes an active competition is linked through `noticeId`, and that transition is a material change event (§13).

**First extension (phase 8): framework agreement expiry,** derived from contract duration in award notices, plus supplier watching. New tables `supplier_watches` and `framework_expiry_estimates`, a `tender-framework-expiry-v1` email template, and the `search_awards` and `list_expiring_frameworks` MCP tools (§32.3).

**Out of scope: municipal sources.** Council meetings, budgets and investment plans are not monitored. This is documented in the terms, the customer-facing coverage text and the support material (§5), and it is not on the roadmap.

## Phase 8 gate: VERIFIED 2026-08-03 — partially satisfied

> **Update, 2026-08-03.** The precondition below has been checked against the live Doffin API. The full evidence is in [`docs/doffin-api-findings.md`](../doffin-api-findings.md) §8. The answer is **partial**, and it splits phase 8 in two.
>
> **(a) Supplier identity — available, and better than hoped.** The JSON search response carries `lots[].winner[].name` together with `.organizationId`, pre-resolved. Fill rate is **219 of 219** sampled award notices. No XML fetch is needed. Supplier watching is buildable as specified.
>
> **(b) Contract duration or end date — not available.** Absent from the JSON entirely. Present in only **2 of 10** award notices examined in the eForms XML. What *is* consistently present is the contract *signature* date, which is not an end date. Under the decision criteria below this is the middle case: **framework-expiry alerting is not buildable from award notices as specified.**
>
> A workaround exists but has a dependency. Contract duration *is* reliably present on the original **competition** notice (`cac:ProcurementProject/cac:PlannedPeriod`), so an end date could be estimated as signature date plus that duration. That requires linking the award back to its competition notice, which is only possible through the eForms `ContractFolderID` — XML-only, and one extra request per notice. If framework expiry is wanted, it ships as an explicitly labelled estimate, never as a stated date.
>
> **Two findings that change the ingest, not just phase 8**, and that are the reason the linkage keys are stored from day one:
>
> - A correction is **not an update to a notice**. Doffin publishes it as a brand-new notice with a new id, referencing the superseded one only inside the XML, only by eForms UUID. Change detection therefore depends on persisting `noticeUuid` and `contractFolderId` for every notice ingested.
> - These keys **cannot be backfilled**. Adding them later means a full re-ingest. They are stored now even though nothing in the MVP reads them.
>
> **One correction to the first reading of the evidence.** An initial pass reported contract durations of "6 MONTH" on competition notices. That was wrong: it matched `cac:TenderValidityPeriod` (how long a bid stays valid), not `cac:ProcurementProject/cac:PlannedPeriod` (the contract length, 48 MONTH on the same notice). Any implementation extracting duration must scope the XPath to `PlannedPeriod`, or it will record bid-validity periods as contract lengths and produce renewal dates that are wrong by years.
>
> **Consequence for the schema:** `supplier_watches` is now unblocked. `framework_expiry_estimates` remains blocked pending a product decision on whether an explicitly uncertain estimate is worth shipping.

**Original text, retained for the record.**

**Whether Doffin award notices actually expose supplier name and contract duration is UNVERIFIED at the time of this decision.** The specification's phase 8 plan depends on it (§50: "Forutsetning som skal verifiseres før fase 8 planlegges i detalj").

This is a **gate for phase 8**. It must be verified against real Doffin data during phase 1, when the live adapter first runs, and the finding must be recorded as an update to this ADR.

Verification procedure: ingest a representative sample of real award notices, inspect the stored `rawPayload`, and record (a) whether a supplier identity field is present and populated, (b) whether contract duration or an end date is present and populated, and (c) the fill rate across the sample, since an optional field that buyers rarely complete is functionally absent.

Decision criteria for the ADR update:

- Both fields present with a usable fill rate: phase 8 proceeds as specified.
- Duration absent but award date and framework indication present: framework expiry becomes an estimate with an explicitly communicated uncertainty, or is dropped. Supplier watching may still proceed if supplier identity is present.
- Supplier identity absent: supplier watching is not buildable from Doffin and phase 8 is re-scoped or dropped.

No field names are assumed here. Per §1 and §53, we do not invent Doffin API fields, and this ADR deliberately describes the fields by what they mean rather than by a guessed identifier.

## Consequences

### Positive

- Planned procurements are a genuine differentiator delivered at essentially zero marginal ingest cost, because they arrive in the stream we already read.
- Category derivation is deterministic and testable, so a planned procurement is never silently presented as an open competition with a missing deadline.
- Storing award notices from day one means phase 8 has years of history available when it is built, with no backfill.
- Declaring municipal sources out of scope, in the terms and in customer copy, is honest about coverage (§3) and prevents a user assuming that no alert means no opportunity.

### Negative / trade-offs

- Coverage of early signal is bounded by what buyers choose to publish. Many procurements have no prior information notice at all, so the planned category is a partial view by construction.
- Below-threshold procurements are often never published on Doffin at all (§5.2), which compounds the gap.
- Competitors who do editorial municipal monitoring can offer earlier signal. Accepted: that is a different, non-free product.
- Phase 8 rests on an unverified assumption, recorded above as an explicit gate rather than as an implicit risk.

## Alternatives considered

- **Scrape municipal websites and council minutes.** Rejected by §5.4 and §7.3. Hundreds of sources, no standard format, and the interpretation is editorial work, not parsing.
- **Infer upcoming procurements from historical patterns per buyer.** Rejected for the MVP: it is a statistical guess presented as a signal, which conflicts with §4.3's prohibition on presenting inference as certainty. Framework expiry, by contrast, is derived from a stated contract duration.
- **Expose award notices as a product surface in the MVP.** Rejected: they are hard-excluded from matching in §14 and would dilute the digest with notices about competitions already lost.
- **Skip ingesting award notices until phase 8.** Rejected by §13: they arrive in the same stream, and not storing them would force a re-ingest of historical data later, which the source may not even permit.

## Verification

- A test asserts `noticeCategory` derivation is a total function over the notice types present in the fixture corpus, with prior information and intention notices mapping to `planned`, award notices to `award`, and an unrecognized type mapping to `other` while logging a warning (never silently).
- A test asserts a `planned` tender receives no deadline penalty and carries the exact Norwegian `notice_type` reason text from §14.
- A test asserts `noticeCategory = "award"` is a hard exclusion in the MVP matching version, so no award notice can reach a digest.
- A test asserts award notices are nonetheless persisted with a complete `rawPayload`, and a round-trip test asserts no field loss between the source payload and stored JSON.
- A test asserts a planned notice transitioning to an active competition, linked by `noticeId`, produces a `tender_change_events` row.
- A UI and email test asserts planned procurements render in their own labelled section, never interleaved with active competitions, and never with an empty deadline field.
- A test asserts the coverage text from §43, including the municipal-signals limitation from §5.4, is present on the landing page and the terms page.
- **Phase 8 gate:** a documented phase 1 task produces a written finding on supplier name and contract duration availability and fill rate in real award notices, and this ADR is updated with that finding before phase 8 is planned in detail. Until that update exists, no `supplier_watches` or `framework_expiry_estimates` schema is created.
