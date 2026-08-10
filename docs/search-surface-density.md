# Search-surface density: which regional pages earn their existence

IDE Agent Spec v3 section 3.2 says to run the density query **first** and let its answer decide which `/anbud-for/[bransje]/[landsdel]` pages exist, rather than generating the full cross product and hoping. This document is that answer, the query that produced it, and the parts of it that are not yet trustworthy.

**Measured:** 2026-08-10, against the 999 notices in the **production** database. (Superseded an identical-shaped 2026-08-09 measurement over a local copy; the numbers moved slightly and one rule changed. See "The 2026-08-10 re-measurement" below.)

## The rule

A `service template × landsdel` pair gets its own statically generated page when it clears **8 active notices** in the window. Below that it collapses into the template's national page. The threshold is the spec's own guide value; the reasoning for keeping it is in "What this measurement cannot tell you" below.

"Active" means `planned` or `competition`. Award notices are ingested but are not opportunities until phase 8, so counting them would inflate every page with competitions already lost.

A landsdel is NUTS level 2 (`packages/domain/src/regions.ts`), derived from the NUTS-3 code rather than from a county table that would rot the next time Norway reorganises its counties.

**Nationwide notices (`locationId: "anyw"`) count towards every landsdel.** That is what nationwide means, and excluding them would understate every regional page — they are the single most common location value in the data. The query below buckets them separately as `ALL` so both numbers stay visible; the qualifying count is `landsdel + ALL`.

## The query

```sql
WITH window_tenders AS (
  SELECT t.id, t.published_at
  FROM tenders t
  WHERE t.suppressed_at IS NULL
    AND t.notice_category IN ('planned', 'competition')
    AND t.published_at >= now() - interval '90 days'
),
tender_landsdel AS (
  SELECT DISTINCT w.id,
         CASE WHEN r.region_code = 'anyw' THEN 'ALL' ELSE left(r.region_code, 4) END AS landsdel
  FROM window_tenders w
  JOIN tender_regions r ON r.tender_id = w.id
),
template_hits AS (
  SELECT st.slug, st.supplier_form, tl.landsdel, tl.id
  FROM service_templates st
  JOIN tender_cpv_codes tc ON tc.cpv_code = ANY (st.cpv_include)
  JOIN tender_landsdel tl ON tl.id = tc.tender_id
  WHERE st.active AND st.deleted_at IS NULL
)
SELECT slug, supplier_form, landsdel, count(DISTINCT id) AS hits
FROM template_hits
GROUP BY slug, supplier_form, landsdel
ORDER BY slug, hits DESC;
```

## The result

Qualifying count is `landsdel hits + ALL`. ✓ means the pair gets its own page.

| Template | form | ALL | NO08 Oslo og Viken | NO09 Agder og Sør-Øst. | NO0A Vestlandet | NO02 Innlandet | NO06 Trøndelag | NO07 Nord-Norge |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `bygg-og-anlegg-utforende` | sector_bound | 12 | 65 ✓ | 40 ✓ | 76 ✓ | 33 ✓ | 40 ✓ | 73 ✓ |
| `it-tjenester-og-konsulentbistand` | cross_sector | 36 | 77 ✓ | 41 ✓ | 58 ✓ | 42 ✓ | 43 ✓ | 47 ✓ |
| `drift-og-vedlikehold-av-eiendom` | cross_sector | 11 | 53 ✓ | 24 ✓ | 33 ✓ | 19 ✓ | 20 ✓ | 38 ✓ |
| `radgivende-ingeniortjenester` | sector_bound | 19 | 40 ✓ | 25 ✓ | 40 ✓ | 26 ✓ | 29 ✓ | 44 ✓ |
| `renhold-og-facility-management` | cross_sector | 1 | 10 ✓ | 4 | 7 | 2 | 5 | 8 ✓ |
| `vakthold-og-sikkerhet` | cross_sector | 1 | 8 ✓ | — | 3 | — | — | 4 |
| `kantine-og-matservering` | cross_sector | 4 | 6 | — | 7 | — | 5 | — |
| `bemanning-og-rekruttering` | cross_sector | 2 | 3 | 3 | 4 | 3 | 3 | 5 |

**27 regional pages qualify**, across 6 of the 8 templates. The other two — `kantine-og-matservering` and `bemanning-og-rekruttering` — collapse entirely to their national page, which is the mechanism working: at four notices a quarter, a regional page for canteen services in Innlandet would be empty most of the time.

`NO0B` (Svalbard og Jan Mayen) never appears at all and gets no page for any template.

## Two findings worth acting on

**1. The regional pages for `it-tjenester-og-konsulentbistand` are mostly the same page.** Of its qualifying counts, 36 hits are nationwide notices that appear on *every* landsdel page. Innlandet's page is 42 notices of which 36 are shared with all five others — six URLs whose content is 86% identical. That is thin, near-duplicate content pointed at a search engine, which is the opposite of what the SEO phase wants. The same pattern is milder but present for `radgivende-ingeniortjenester` (19 shared).

This is not an argument against the pages. It is an argument that a regional page must **visibly separate** the notices that are actually regional from the nationwide ones, rather than merging them into one list — otherwise the six pages differ only in their heading.

**Decided (2026-08-09, product owner): separate sections, and all 27 pages stay.** A regional page renders the notices for its own landsdel first, then a clearly labelled «gjelder hele landet» section below them. Nationwide notices keep counting towards the qualifying threshold. The rejected alternative was excluding them from the threshold, which would have cut the `it-tjenester` and `radgivende-ingeniortjenester` regional pages sharply; the reasoning for keeping them is that a nationwide competition is a real opportunity for a supplier in that landsdel, so a page that hid it to look more distinctive would be optimising the page against the reader. Building the sections separately is what keeps the six pages from being six copies.

**2. The `cross_sector` templates are the ones that struggle regionally.** Three of the four templates that fail or barely clear the threshold are `cross_sector`, and that is consistent with ADR-17's reasoning: for a cross-sector supplier the buyer can be anyone, so demand is thin and evenly spread rather than clustered. Spec v3 section 3.2's requirement that national pages for `cross_sector` templates carry a visible region selector is doing real work here — for those suppliers, national *is* the correct default view and the selector is how they narrow it themselves.

## The 2026-08-10 backfilled measurement — this is the current one

**94 days, 4017 notices, 2671 active in the window.** Reached with `runBackfill`, which partitions by issue-date fortnights; the hourly sync cannot get there, because Doffin serves at most 1000 hits per query and that is about five weeks of notices. Seven windows, 4105 fetched, zero failures, no window truncated.

**31 pairs qualify**, and the rule changed to get there.

### Nationwide notices stopped counting towards the threshold

They used to, deliberately: a nationwide competition is a real opportunity for a supplier in that landsdel, and hiding it would optimise the page against its reader.

That held while the nationwide pool ran 1–36 notices. Over 94 days it runs **9–144**, and the rule inverted — the shared pool alone cleared the threshold everywhere, so **48 of the 56 possible pairs qualified**, including:

- `bemanning-og-rekruttering` in six landsdeler on own-counts of **1, 2, 2, 3, 4 and 6**. One regional notice above nine nationwide ones is not a regional page.
- `it-tjenester-og-konsulentbistand` with 144 shared notices against 20–128 regional. Six pages sharing 144 notices apiece is one page with six URLs.

So the threshold now measures only what makes a page distinct: **a landsdel's own notices**. Nationwide notices still render, in their own labelled section, and still matter to the reader — they no longer justify a page existing. The reader loses nothing and the index gains 17 fewer near-duplicates.

### The resulting pages

Own notices in the 94-day window; a landsdel needs 8.

| Template | NO08 | NO09 | NO0A | NO02 | NO06 | NO07 | Pages |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `bygg-og-anlegg-utforende` | 187 | 84 | 228 | 60 | 97 | 181 | 6 |
| `it-tjenester-og-konsulentbistand` | 128 | 22 | 55 | 29 | 20 | 37 | 6 |
| `drift-og-vedlikehold-av-eiendom` | 120 | 43 | 95 | 30 | 30 | 73 | 6 |
| `radgivende-ingeniortjenester` | 84 | 32 | 71 | 24 | 36 | 54 | 6 |
| `renhold-og-facility-management` | 15 | 6 | 31 | 5 | 11 | 17 | 4 |
| `vakthold-og-sikkerhet` | 15 | 5 | 9 | 2 | 1 | 6 | 2 |
| `kantine-og-matservering` | 18 | 1 | 6 | 0 | 6 | 2 | 1 |
| `bemanning-og-rekruttering` | 3 | 2 | 6 | 2 | 1 | 4 | **0** |

`NO0B` (Svalbard og Jan Mayen) has 1 own notice across the entire corpus and gets no page anywhere.

`bemanning-og-rekruttering` has a national page and nothing else. Six own notices in Vestlandet over three months is a trade whose demand does not cluster geographically, which is the mechanism working rather than a gap.

## The earlier 2026-08-10 measurement, over 37 days

Re-run against production once `service_templates` was seeded there. **29 pairs qualify**, up from 27, and the counting rule gained a second condition.

### The rule needed a floor on a landsdel's own notices

Counting nationwide notices towards the threshold produced a result nobody would want: **`NO0B` (Svalbard og Jan Mayen) qualified for four templates on zero regional notices of its own.** `bygg-og-anlegg-utforende` showed `NO0B=12` — all twelve borrowed from the nationwide pool.

Those pages would have rendered an empty regional section above a «gjelder hele landet» list identical to the other six landsdeler. That is the emptiest page the system can produce and the most duplicative, which is precisely what the two-section layout was chosen to avoid.

So a pair now needs at least one notice of its own as well as clearing the threshold (`MINIMUM_OWN_NOTICES` in `qualifying-pages.ts`). The bar is deliberately low: the threshold decides whether a page is *worth* having, and this only rules out the case where calling it a regional page is untrue.

### What changed in the page list

`kantine-og-matservering` gains `NO08` and `NO0A`. Both have 3 notices of their own plus the 5 nationwide, landing exactly on 8 — the case the counting rule exists to admit, and the mirror image of the Svalbard case it now excludes. Everything else is unchanged.

`NO0B` gets no page for any template, which was true in the first measurement too, but for the accidental reason that it had too few notices rather than the principled one.

## What this measurement cannot tell you

**The window is 37 days, not 90.** The corpus runs 2026-07-02 to 2026-08-08. The query asks for 90 days and the data cannot answer for more than 37, so every count here is an **undercount** of what a full window would produce, and the true number of qualifying pairs is higher than 27 — possibly enough to qualify `kantine-og-matservering` and the remaining `renhold` regions.

The reason the corpus is short is worth recording, because it was a live-system finding rather than a local inconvenience: **the ingest checkpoint never advanced.** `ingestion_checkpoints` was empty after eighteen ingest rounds. Every round returned `status: partial`, and `runIngest` writes the checkpoint only on a fully successful run — by design, so a partial failure cannot skip notices forever. The failures were all the same: a duplicate key on `tender_revisions (tender_id, source_payload_hash)` while re-reading notices that had not changed. Combined, the two behaviours meant ingest re-read the same recent window indefinitely and could never walk forward.

**Fixed.** The root cause was an order-sensitive payload hash meeting a source that reorders its own arrays; see `hashPayload` in `@luma/doffin` and `insertRevision` in `apps/core/src/services/tender-repository.ts`. Verified against the live API afterwards: `status: succeeded`, `failed: 0`, checkpoint advancing, and successive runs reporting 300 fetched / 300 unchanged / 0 updated — genuinely idempotent rather than merely not crashing.

That does not retroactively lengthen the corpus this document was measured against, so the 37-day caveat above still stands and the re-run is still needed.

**Therefore: re-run this query before the pages are deployed**, against a database with a genuine 90-day corpus, and update the table above. The threshold and the mechanism are settled; the specific 27 are not.

**The counts are CPV-only.** The density query matches templates to notices on `cpv_include` alone, while the real matcher also uses keywords, exclusions and value bounds. So these numbers approximate demand rather than predicting what any individual profile will match. They are the right input for "does this page have enough on it to exist", and the wrong input for anything a user is shown.
