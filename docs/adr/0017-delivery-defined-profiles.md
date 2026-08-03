# ADR-0017: Delivery-defined profiles, and no sector assumptions in templates

- **Status:** Accepted
- **Date:** 2026-08-04
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** «Spesifikasjon: Tjenestemodellen» §1–§9; supersedes parts of v2 §8, §11.2, §24, §44

## Context

An alert profile can be described in two ways: by what the business **delivers**, or by which industry it **belongs to**. They look interchangeable and are not.

For a large share of suppliers, the industry is the competitors and the customers are everyone else. A cleaning company competes with other cleaning companies and sells to hospitals, schools, transit operators, museums and the armed forces. The buyer's sector carries no information about whether a tender fits. Any model that uses the supplier's industry as a filter — or worse, as a default — actively destroys match quality for that kind of business, and destroys it invisibly: the tenders simply never arrive, and nothing in the product explains why.

The service was built before this was written down. That turns out to matter less than it might have, because the engine already treats an empty buyer field as an open buyer side, and the template seeds never had buyer-side fields to populate. What was missing was not the behaviour but the **guarantee**: the rule held because nobody had happened to break it.

Two supplier forms exist and neither is the norm:

- **Sector-bound.** Demand clusters in particular buyer domains. A consulting engineer in transport finds work at the roads authority, county councils and municipal agencies. Narrowing on buyer type is useful here — as the user's own choice.
- **Cross-sector.** The service is the identity and the buyer can be anyone. Cleaning, catering, security, staffing, IT operations, transport. Here the service CPV plus geography is the entire profile, and geography is the load-bearing second axis: for a cleaning company in Bergen, "the whole country" is as wrong as "health sector only".

The form is a property of the profile, not of the business. One business may hold one of each.

## Decision

**A profile's core is service CPV and keywords. The buyer side is open by default. Every narrowing on the buyer side is the user's own explicit act.**

Four consequences follow, and each is enforced rather than documented.

1. **No template may narrow the buyer side.** Templates carry service CPV, keywords and typical exclusion terms. They carry no `buyerInclude`, `buyerExclude`, `noticeTypes` or `procedureTypes`, and no CPV code from a buyer-sector division (75 public administration, 80 education, 85 health), because such a code describes the customer rather than the service.

2. **`supplierForm` never influences matching.** It weights onboarding — geography is emphasised for cross-sector — and it groups analysis. The engine must not be able to read it, or `serviceCategory`, or the template id, even accidentally.

3. **`serviceCategory` is the only segmentation key.** All analysis, reporting and promotion routing segment on the declared service category. Never on NACE, never on award history.

4. **"Bransjemal" becomes "tjenestemal" throughout.** This is a model change wearing a vocabulary change: the old word invited exactly the error above, by describing who the business is instead of what it sells.

### The identity hierarchy

Where delivery identity comes from, in order of authority:

1. The user's declared profile. Authoritative.
2. Behaviour — saved, shared, reported as delivered. Supporting signal.
3. Brønnøysund enrichment — size, age, company form. NACE is secondary and is never a category key.
4. Award data. Outcome measurement only, always with the coverage caveat.

Award history is never a source of what a business delivers. Three reasons, all structural: CPV tagging on notices is coarse, framework agreements bundle unrelated disciplines, and turnkey contracts make the subcontractor layer invisible. That last one is a finding worth stating plainly in any report rather than hiding as a weakness — a substantial part of the supplier market delivers through main contractors and does not appear in public award data at all.

## Consequences

### Positive

- The cross-sector supplier, who is the hardest case and the one most poorly served by industry-based tools, is served correctly by default rather than by configuration.
- The demand map per service category becomes possible, and it exists only because of this model: for each category, who buys the service, in what contract sizes and regions, and which buyer types are tendering now that were not last year. Nobody can build it from public data alone, because it needs the join between notices and what suppliers are actually looking for.
- The rules are testable, and are now tested.

### Negative

- A rename with a migration, touching the schema, seventeen source files and every customer-facing mention.
- The mapping from the five existing templates to the eight new ones is lossy. One template splits in two and one has no successor, and no data in the system decides where an existing profile should land. That is an editorial call, not an engineering one.
- `serviceCategory` keys must be stable forever: categories may be added, never renamed, or every time series silently rebases.

## Verification

Three invariants, each shown to fail before being trusted:

- `packages/content/src/no-buyer-side-assumptions.test.ts` — the seed schema declares no buyer-side field, rejects one if added rather than stripping it, no seed carries one, and no template includes a buyer-sector CPV division. Proved by adding `buyerInclude` to the schema (3 failures) and by giving a template CPV 85 (1 failure).
- `packages/matching/src/no-sector-assumptions.test.ts` — the engine's source contains no identifier naming a supplier identity or buyer sector; a tender scores identically whoever the buyer is when the user named none; and a buyer exclusion the user *did* state still takes effect. Proved by leaking `buyerSector` into the engine, and by adding a three-point nudge for buyers whose name contains "Helse", which failed this test and ten others including the golden set.
- The existing `no-commercial-influence.test.ts` is unchanged and still guards the marketing boundary. This ADR adds a second, orthogonal boundary: not just "commerce must not influence ranking", but "identity must not influence ranking".

## Alternatives considered

**Keep "bransjemal" and add cross-sector templates alongside.** Rejected. The word is the defect. A template set that says "industry" while meaning "service" will drift back toward buyer assumptions the first time someone adds a template without reading this document.

**Infer the service category from award history or NACE.** Rejected on the grounds in the identity hierarchy above. It is also the more seductive option, because the data is right there and looks authoritative — which is why the prohibition is a test rather than a paragraph.
