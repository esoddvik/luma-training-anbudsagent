# Doffin edge cases

Things found while probing the live API on **2026-08-03** that will bite the implementation. Counts are from a
1000-notice sample (published 2026-06-30 → 2026-08-03) unless stated otherwise. Everything here was observed, not
assumed; the few open questions are marked **UNVERIFIED**.

---

## 1. Silent failure modes (most dangerous first)

### Unknown query parameters return 200 with the full result set

`?id=2026-112546`, `?publicationDateFrom=2026-08-01`, `?buyer=817209882` — all return `200` and
`numHitsTotal: 157143`, i.e. **everything**. No error, no warning. A typo'd or wished-for filter name silently
widens the query to the whole database instead of failing.

Worse, it can look like it worked: `?id=2026-112546` returns a page whose first hits include that notice, because
the default sort happens to put it there.

**Guard:** after applying any filter, assert `numHitsTotal` actually decreased. Never build query strings from
unvalidated names. The verified-real parameters are exactly: `numHitsPerPage`, `page`, `sortBy`, `searchString`,
`cpvCode`, `location`, `type`, `status`, `issueDateFrom`, `issueDateTo`.

### `TenderValidityPeriod` is not contract duration

In the eForms XML, the first `cbc:DurationMeasure` in the document is usually
`cac:TenderValidityPeriod/cbc:DurationMeasure` — how long a *bid* stays valid (6 MONTH on the sampled contract
notice). The contract duration is `cac:ProcurementProject/cac:PlannedPeriod/cbc:DurationMeasure` (48 MONTH on the
same notice).

An unscoped XPath or regex silently records bid-validity periods as contract lengths. **Scope to `PlannedPeriod`.**
This one already caught me mid-investigation.

### A bad `sortBy` returns a bodiless 404

Indistinguishable from a wrong URL. Valid values are only `PUBLICATION_DATE_ASC`, `PUBLICATION_DATE_DESC`,
`DEADLINE`, `RELEVANCE`, `ESTIMATED_VALUE_DESC`. Note the inconsistency: `DEADLINE` has no `_ASC`/`_DESC` suffix
while the publication sorts require one, and `DEADLINE_DESC` does not exist.

---

## 2. Notice type and category

### `ANNOUNCEMENT_OF_INTENT` rolls up to `RESULT`, not `PLANNING`

Intensjonskunngjøringer must become `noticeCategory: "planned"` per spec §13, but Doffin tags all 20/20 of them
`allTypes: ["ANNOUNCEMENT_OF_INTENT", "RESULT"]` — the same roll-up as a real award. **Deriving the category from
`allTypes` misclassifies every intensjonskunngjøring as an award.** Derive from the single-valued `type`.

### `allTypes` is not a partition

- 24/623 `ANNOUNCEMENT_OF_COMPETITION` also carried `PLANNING` **and** `NOTICE_ON_BUYER_PROFILE`.
- 3/35 `CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT` also carried `ADVISORY_NOTICE` and `PLANNING`.

A notice can be simultaneously `PLANNING` and `COMPETITION`. Only `type` is single-valued.

### The XML root element cannot distinguish notice types

`ANNOUNCEMENT_OF_INTENT`, `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT` and
`CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT` are **all** `<ContractAwardNotice>`. Only
`cbc:NoticeTypeCode/@listName` separates `veat` from `result`, and even then `can-standard` covers both a genuine
award and a cancellation — the JSON `type` is the only clean discriminator.

### A notice with a winner is not necessarily an award

`lots[].winner[]` is populated on **two** notice types:

| type | with winner |
|---|---|
| `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT` | 219/219 |
| `ANNOUNCEMENT_OF_INTENT` | **20/20** |
| `CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT` | **0/35** |
| everything else | 0 |

An intensjonskunngjøring names the supplier the buyer *intends* to award to without competition — that is the
entire point of a VEAT notice. So `winner` is present, but no contract has been awarded, and the notice is
`noticeCategory: "planned"` per spec §13. The committed `intention-notice.json` fixture shows this: type
`ANNOUNCEMENT_OF_INTENT` with winner `Medanets OY`.

Two consequences:

- **Never infer "this is an award" from the presence of a winner.** Use `type`.
- Conversely, a `RESULT`-category notice with **no** winner is the cancelled/unsuccessful case
  (`CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT`, 0/35 with winners). Winner-presence is a usable signal for
  *that* distinction, but only after `type` has already been checked.

For phase 8 this is a small bonus: intent notices also expose a supplier name, so "who is about to win this
without a competition" is answerable — and arguably more commercially interesting than a completed award.

### The type enum is server-side and can grow

`400` bodies leak `no.dfo.dof.notices.domain.elements.NoticeType`. Eight values observed; there may be more in
older data (the sample covers only five weeks). The `default` branch of any switch must `console.warn` the unknown
value rather than silently returning `other`.

---

## 3. Missing and null data

| Field | Null / empty rate | Notes |
|---|---|---|
| `status` | **396/1000 null** | Null for 100% of award, intent, advisory and cancelled notices. Only live competitions carry a status. |
| `estimatedValue` | **530/1000 null** | 47% of notices have no value at all. |
| `deadline` | **309/1000 null** | Type-dependent, see below. |
| `receivedTenders` | 726/1000 null | |
| `allReceivedTenders` | 758/1000 null | |
| `limitedDataFlag` | **1000/1000 null** | Legacy. Do not assume it stays null forever. |
| `doffinClassicUrl` | **1000/1000 null** | Cannot be used to build `sourceUrl`. |
| `locationId` | 2/1000 empty array | Rare but real. |
| `lots` | 1/1000 empty array | Rare but real — do not assume `lots[0]` exists. |

Never null in 1000/1000: `id`, `buyer`, `heading`, `description`, `cpvCodes`, `type`, `allTypes`, `issueDate`,
`publicationDate`.

### Deadlines are missing by design on planned notices

- `ADVISORY_NOTICE`: **93/93 null** — every veiledende kunngjøring.
- `ANNOUNCEMENT_OF_INTENT`: 18/20 null.
- `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT`: 165/219 null.
- `ANNOUNCEMENT_OF_COMPETITION`: only **4/623** null — a competition notice almost always has one, but not always.

Spec §13 already says planned procurements skip the deadline component without penalty. The 4 competition notices
with no deadline are the case to be careful about: they are `competition` category, so the deadline component will
run, and it must tolerate `null`.

---

## 4. Dates and timezones

- `issueDate` — full UTC timestamp, `"2026-07-30T12:36:32Z"`. Always `Z`, never an offset.
- `publicationDate` — **date only, `"2026-08-03"`**, no time, no zone. Coercing it to a `Date` silently implies
  midnight in whatever zone the runtime picks. Decide the convention explicitly.
- `deadline` — full UTC timestamp with `Z`.

### Deadline times look wrong if you assume local time

The most common deadline time is `10:00Z` (547/1000), which is **12:00 Norwegian local** in summer. Other clusters:
`21:59Z`/`22:00Z` (21 notices) are **23:59 / 00:00 local** — end-of-day deadlines. And 62 notices have exactly
`00:00Z`, which is 02:00 local and almost certainly means "date only, no meaningful time".

Displaying the raw UTC time to a Norwegian user will show the wrong hour. Convert to `Europe/Oslo` for display,
and treat `00:00:00Z` as a date-only deadline rather than a 2 a.m. cutoff.

### `publicationDate` can trail `issueDate` by up to a week

Lag distribution (days): 0 → 59, 1 → 628, 2 → 140, 3 → 103, 4 → 68, 5 → 1, 7 → 1. Never negative.

**This is why the sync watermark must be on `publicationDate`, not `issueDate`** — a notice issued before the
watermark can be published after it. The `issueDateFrom` filter, being the only date filter, is a trap for
incremental sync.

---

## 5. Versions, corrections and duplicates

### No duplicate ids within a page

0 duplicates across 1000 hits, and page 1 + page 2 at the same page size shared 0 ids. `id` is a stable primary
key in the format `YYYY-NNNNNN` (all 1000 matched `^\d{4}-\d+$`).

### But a corrected notice is a *different* notice

Corrections are published as a **new notice with a new Doffin id and a new eForms UUID**, back-referencing the
superseded one — observed on `2026-111809`:

```xml
<efac:Changes>
  <efbc:ChangedNoticeIdentifier>31ee646a-d4df-4ca5-a1ef-5241be87f845-01</efbc:ChangedNoticeIdentifier>
</efac:Changes>
```

So the same procurement appears as multiple Doffin ids. Consequences:

- **Deduplication by `id` will not collapse them.** The user may see the same tender twice in a digest.
- The link exists **only in the XML**, and it is by eForms UUID, not by Doffin id. Resolving it requires storing
  the XML's `cbc:ID[@schemeName="notice-id"]` UUID for every notice at ingest time. **Not storable later without a
  full re-ingest.**
- `cbc:ContractFolderID` (also XML-only) groups notices about the same procurement, and is the only way to link a
  planned notice to the competition that follows it. Absent on the sampled `ADVISORY_NOTICE`, so not universal.

### `cbc:VersionID` is useless as a revision counter

`01` on every notice examined — including the corrected one above. Do not use it for `sourceRevision`.

### UNVERIFIED: does the superseded notice stay in the search index?

Not testable in a single session. If both versions remain searchable, the digest could surface a stale deadline
from the superseded notice. Worth an explicit check once the sync job has run for a few days.

---

## 6. Pagination

### The 1000-hit ceiling is absolute

`page × numHitsPerPage > 1000` →
`400 {"reason":"Unable to access more than the top 1000 hits, please lower either the page or numHitsPerPage parameters."}`

A larger page size does not help. `numHitsAccessible` tells you the real ceiling for the current query
(`min(numHitsTotal, 1000)`). To read more, partition by `issueDateFrom`/`issueDateTo`, `type`, `cpvCode` or
`location`. A one-month issue-date window returned 939 hits — close enough to 1000 that a week is the safe
partition size.

At ~32 notices/day (max 99/day observed), a routine incremental run is nowhere near the ceiling. A **backfill is**.

### Page boundaries shift between page sizes

Two identical calls return identical ordering — ordering is deterministic per query. But `numHitsPerPage=25`
pages 1+2 versus `numHitsPerPage=50` page 1 covered different sets: **5 of the 50 were missing** from the two
25-item pages. `publicationDate` has only day granularity and the intra-day tie-break is not by `id`.

**Fix the page size for an entire paging run, and dedupe by `id`.** Do not compare or resume across runs with
different page sizes.

---

## 7. Values, buyers, geography

### `estimatedValue` is a single scalar, not a range

`{"currencyCode": "NOK", "amount": 40000000}`. Spec §13's `estimatedValueMinNok`/`MaxNok` pair has no source —
set both to the same number. And it is absent 53% of the time.

### Not all values are in NOK

Observed `NOK` and **`PLN`**. Any threshold comparison against a NOK figure must convert first, and the API
supplies no exchange rate. Filtering on value without checking `currencyCode` will produce wrong matches.

### `organizationId` is not always a Norwegian org number

Never null, but observed string lengths of **3, 9, 11, 17 and 49** characters. Foreign buyers and consortia break
the 9-digit assumption. One award XML even contained `964 830 711` — **with spaces**. Do not validate as
`/^\d{9}$/`, and normalise whitespace before matching.

### `buyer` is an array

74/1000 notices had more than one buyer (joint procurements). Taking `buyer[0]` silently drops co-purchasers,
which matters for buyer-based matching rules — a user watching for their municipality will miss notices where it
is the second buyer.

### `locationId` includes a non-NUTS sentinel

`"anyw"` (= anywhere / nationwide) appeared on **182/1000** notices — the single most common value, ahead of
`NO081` (161). It is not a NUTS code and will not match any geography rule that assumes NUTS format. Nationwide
notices are relevant to *every* region, so treating `anyw` as "no match" would drop 18% of notices from
geography-filtered profiles.

Also present: `NOZZZ` (unspecified, 4/1000) and foreign NUTS codes such as `FI1D9`.

### Municipality data does not exist

The finest geography is NUTS-3 (county-level). The XML's `cbc:CityName` is the **buyer's postal city**
(`TOLVSRØD`, `BÆRUM`, `OSLO`), not the place of performance — using it to populate `municipalities` would be
actively wrong. Spec §13's `municipalities` has no source.

---

## 8. CPV, lots, text

### CPV is always present but can be enormous

Never empty (0/1000), always 8-digit strings, but **up to 86 codes on a single notice**. One award notice listed
29. Buyers shotgun the hierarchy, so a naive "any CPV matches" rule will over-match badly. Note that the API's own
`cpvCode` filter is hierarchical (`45000000` matched 41820 notices), so prefix matching is the expected semantics.

### Multi-lot notices are common

64/1000 have more than one lot, **up to 14**. Each lot has its own `heading`, `description` and `winner[]`. A
14-lot award has 14 potentially different winners. Flattening to a single winner loses most of the data.

Lot `heading` was never null (0/1167 lots), but the `lots` array itself was empty once.

### Norwegian characters are fine — descriptions are not

UTF-8 throughout (`Content-Type: application/json; charset=UTF-8`); `æøå`, `«»` and uppercase `ÆØÅ` all round-trip
correctly. No mojibake observed.

But `description` is free text that may contain embedded newlines, typographic quotes, and **personal contact
details**: 11/1000 sampled notices had e-mail addresses in the description, several as a full
`Kontaktperson / Navn: <person> / E-post: <address>` block, and some with markdown-style link syntax
(`jonas.olsen@... [jonas.olsen@...]`). Anything that renders, forwards, e-mails or sends this text to an AI model
must assume personal data is present.

---

## 9. Operational

### Rate limit is tight and has no quota headers

28 successful minimal requests, then `429` after ~7.7 s; recovered ~6 s later. Roughly 30 requests per 10-second
window. There are **no** `X-RateLimit-*` headers to steer by — the only signal is the `Retry-After` header (in
seconds) that appears on the `429` itself, plus the countdown embedded in the message text.

A sync that downloads the eForms XML per notice doubles the request count. At ~32 notices/day that is fine
sequentially, but any concurrency will trip the limit immediately.

### Two incompatible error body shapes

Gateway errors use `{"statusCode": N, "message": "..."}`; application errors use `{"reason": "..."}`. A parser
that only knows one shape will log `undefined` for the other. And a bad `sortBy` returns `404` with an **empty
body**, so the parser must tolerate no body at all.

### Do not point at `betaapi.doffin.no`

It hosts the same `/public/v2/search` path but rejects the production key with `401`. Easy to reach for while
debugging and easy to misread as "the key is broken".
