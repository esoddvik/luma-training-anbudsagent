# ADR-0018: Doffin announcement data is CC BY 4.0; documents are not

- **Status:** Accepted
- **Date:** 2026-08-08
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §5, §7, §16, §18, §19, §43, §51 (blocker 9). Introduced by IDE Agent Spec v3, section 2.

## Context

Blocker 9 in §51 asks two separate questions that have been carried as one line:

1. Is the Doffin connection stable?
2. Have the source's terms of use been checked?

The first was answered during phase 1 and is recorded in [`doffin-api-findings.md`](../doffin-api-findings.md). The second was recorded in [`launch-readiness.md`](../launch-readiness.md) as an unqualified gap — "Nobody has read Doffin's terms of use" — and blocked the public search surface that IDE Agent Spec v3 introduces, because publishing announcement data on indexable pages is a redistribution question, not a fetching question.

This ADR answers the licensing half. It does not answer all of it, and the split matters enough to be the first thing stated.

### What was verified

The Norwegian open data registry lists the dataset **"Kunngjøringer av offentlig anskaffelser"** (`a77b0408-85f9-3e12-8a66-8d500b492e9d`) with:

- **Licence:** `https://creativecommons.org/licenses/by/4.0/deed.no` — Creative Commons Attribution 4.0 International.
- **Publisher:** Direktoratet for forvaltning og økonomistyring (DFØ).
- **Distribution:** a CSV file of announcements. **No API is registered on that dataset record.**

Source: <https://data.norge.no/en/datasets/a77b0408-85f9-3e12-8a66-8d500b492e9d/kunngjoringer-av-offentlig-anskaffelser>

### What was not verified, and is deliberately left open

The registered distribution is CSV. This service does not read the CSV; it reads the Azure APIM notices API with a subscription key (`DOFFIN_SUBSCRIPTION_KEY`), which requires sign-up and issues a subscription per consumer. That is a different channel with its own terms of service, and **those terms have not been read.**

The distinction is not pedantry. CC BY 4.0 is a licence on *content*, so the argument that the same announcement content carries the same licence regardless of which pipe it arrives through is a good one, and it is the basis on which the attribution decision below is made. But an API's terms of service can independently constrain *use of the API* — rate limits, redistribution of responses, caching, resale — without touching the licence on the data. A CC BY 4.0 content licence does not pre-empt them.

So blocker 9 is split rather than closed. See "Consequences" for exactly what each half now says.

## Decision

**1. Announcement data may be published on public, indexable pages, with attribution.**

Structured announcement data — buyer, title, description, CPV codes, values, deadlines, notice type, status — is open data under CC BY 4.0. It may appear on unauthenticated pages, in the shared view, in public search results, and in reports.

**2. The attribution line is mandatory and its wording is fixed.**

> `Data: Doffin/DFØ (CC BY 4.0)`

It appears on every surface that presents announcement data to someone who is not the user who asked for it:

| Surface | Placement |
| --- | --- |
| Public tender detail page (`/kunngjoring/[id]`) | Page footer, below the content |
| Public search and industry pages (`/finn-anbud`, `/anbud-for/...`) | Below the result list |
| Shared view (`/delt/[token]`) | Footer, alongside the existing invitation block |
| Exported reports | Footer of the document |

The licence identifier links to `https://creativecommons.org/licenses/by/4.0/deed.no`. The authenticated dashboard is exempt: it is not redistribution, it is the user reading their own alerts.

**3. The licence stops at the announcement. Competition documents are not covered.**

Konkurransegrunnlag — the tender documents themselves — are authored by individual contracting authorities and hosted in KGV systems (Mercell, TendSign, CTM). They are not part of the registered dataset and carry no blanket open licence. Their copyright sits with the authoring body.

This is the reason for the rule in IDE Agent Spec v3 section 5: **announcement data may be a public page; documents are always user-scoped.** Concretely, and as code requirements rather than guidance:

- No document byte is ever served unauthenticated.
- No document is listed publicly, and nothing document-derived enters a sitemap.
- Document text extracted for search or MCP reading is served only to the user who requested the fetch, under the Pluss entitlement.
- A takedown switch exists from the day the pipeline runs (IDE Agent Spec v3 section 6), because the copyright holder is a third party who can object.

**4. No misleading presentation, no implied endorsement.**

CC BY 4.0 permits redistribution; it does not permit implying the licensor endorses you. Announcement data must not be presented in a way that suggests DFØ approves of, or is affiliated with, Luma Anbudsvarsling. The §43 coverage text already tells users what the service does and does not see, and it stays.

**5. The v2 rule against visually imitating Doffin stands, unchanged.**

The licence makes the data reusable. It says nothing about trade dress. Not looking like Doffin remains a product rule.

## Consequences

### Blocker 9 splits into 9a and 9b

- **9a — data licence for redistribution: closed.** Announcement data is CC BY 4.0 from a named registry record with a named publisher. The public search surface is unblocked.
- **9b — the notices API's own terms of service: still open, still external.** Nobody has read them. This must be settled before the service is publicly launched, and it is not an engineering task. It is smaller in scope than the original blocker, and it no longer blocks building the public surface.

`launch-readiness.md` is updated to carry both lines rather than one.

### Positive

- The public, indexable search surface that the whole search-first funnel depends on now rests on a verified licence rather than an assumption.
- The announcement/document boundary is now a stated legal rationale, not just an architectural preference, which makes it much harder to erode later. "Why is this user-scoped?" has an answer that survives a product argument.
- Attribution wording is fixed in one place, so it cannot drift per surface.

### Negative / trade-offs

- An attribution line on every public surface is visual cost on pages designed to convert. Accepted: it is a licence condition, not a choice.
- The service depends on a channel (the API) whose terms are unread, while claiming a licence verified on a different channel (the CSV). This is a real, named gap, not a closed one. If the API terms turn out to restrict redistribution of responses, the public pages are affected and this ADR needs revisiting — the CSV dump would then become the lawful source for the public surface, at the cost of freshness.
- CC BY 4.0 requires attribution "in the manner specified"; DFØ has not specified a form. The wording above is our good-faith reading, not a form DFØ has blessed.

## Alternatives considered

- **Treat the whole thing as settled by the spec's assertion and skip verification.** Rejected. The spec asserts CC BY 4.0 and the first search for it surfaced NLOD 2.0, a different Norwegian public-data licence, as a plausible competing answer. Had NLOD been correct, the attribution string would have been wrong on every public page in the product. The registry record is what settles it.
- **Close blocker 9 entirely, as IDE Agent Spec v3 section 2 instructs.** Rejected in that form. The blocker's own words ask for "the source's terms of use", and the verified evidence is a dataset licence on a distribution we do not consume. Closing it whole would record a check that was not performed. Splitting it keeps the spec's intent — unblock the public surface — without the overclaim.
- **Attribute only on the tender detail page.** Rejected. Search and industry pages present announcement data too, and they are the pages built to be indexed and shared.
- **Serve documents publicly and rely on takedown.** Rejected outright. No licence covers them, the copyright holder is a third party, and the exposure scales with every fetch.

## Verification

- A test asserts the attribution line, with the exact string `Data: Doffin/DFØ (CC BY 4.0)`, is present on the public tender detail page, the public search page, the industry pages and the shared view, and that the licence URL resolves to the CC BY 4.0 deed.
- A test asserts the attribution line is absent from the authenticated dashboard, so the rule reads as "redistribution" and not "sprinkle it everywhere".
- A test asserts no document route answers without an authenticated session carrying the Pluss entitlement, and that an unauthenticated request receives 401 rather than a redirect that could be followed to content.
- A test asserts no document or document-derived URL appears in `sitemap.ts` output.
- A test asserts the public read path applies `suppressedAt` filtering independently, so a suppressed tender cannot be reached through the public surface even though `assertTenderAccess` is bypassed there (IDE Agent Spec v3 section 3.3).
- `launch-readiness.md` carries blocker 9 as two rows, 9a closed with this ADR cited and 9b open and marked external. A reader who wants to know whether Doffin's terms were read gets "no" without having to infer it.
