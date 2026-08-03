# Doffin API — reconnaissance findings

**Captured:** 2026-08-03 (all empirical results in this document were produced on this date)
**Method:** live `GET` requests against the production API using the repo's `DOFFIN_SUBSCRIPTION_KEY`.
**Status of the key:** **working.** Every `200` below is a real response.

Statements are labelled:

- **[verified]** — observed directly in a response during this session.
- **[inferred]** — a reasonable conclusion from observed data, but not directly proven.
- **[unverified]** — from documentation or third parties; not confirmed against the live API.

> Nothing in this document is a guess about a field name. Every field name listed was read out of an actual
> response body. Where a field the spec wants does not exist, it is recorded as a gap, not invented.

---

## 1. Documentation sources

| Source | URL | Usefulness |
|---|---|---|
| DFØ Doffin API Management — production developer portal | `https://dof-notices-prod-api.developer.azure-api.net/` | Portal exists but is a JavaScript SPA; server-rendered fetches return only the shell. No spec could be extracted without signing in. |
| DFØ Doffin API Management — dev/test portal | `https://dof-notices-dev-api.developer.azure-api.net/` | Same; sign-up/subscription flow lives here. |
| Norwegian eForms SDK (DFØ) | `https://github.com/anskaffelser/eforms-sdk-nor` | The authoritative code lists for the eForms payloads returned by the XML download endpoint. |
| `anskaffelser/doffin` | `https://github.com/anskaffelser/doffin` | **Archived Oct 2020, describes the previous API.** Do not use. |
| `reidar80/DoffinMCP` `TECHNICAL.md` | `https://github.com/reidar80/DoffinMCP/blob/main/TECHNICAL.md` | **Wrong.** Documents `https://dof-notices-prod-api.developer.azure-api.net/public/v1/notices/search` with fields `noticeId`, `publishedDate`, `buyerName`, `totalCount`, `page`, `pageSize`. That host is the *portal*, not the gateway, the `v1` path 404s, and none of those field names exist in the real response. Listed here so nobody rediscovers it and trusts it. |

**No machine-readable OpenAPI/Swagger document could be found.** `/{swagger,openapi}.json` under both the gateway root
and `/public/v2` return `404` **[verified]**. Everything below was derived by probing.

---

## 2. Base URL, endpoints, auth

**Gateway host:** `https://api.doffin.no` — an Azure API Management gateway **[verified]**
(unmatched paths return APIM's `{"statusCode":404,"message":"Resource not found"}`).

**Auth header:** `Ocp-Apim-Subscription-Key` **[verified]** — the assumption in the brief is correct.
An invalid/absent key yields:

```json
{ "statusCode": 401, "message": "Access denied due to invalid subscription key. Make sure to provide a valid key for an active subscription." }
```

Two endpoints exist on the public product. Both are `GET`.

| # | Endpoint | Returns |
|---|---|---|
| 1 | `GET https://api.doffin.no/public/v2/search` | JSON search/list. `Content-Type: application/json; charset=UTF-8`. |
| 2 | `GET https://api.doffin.no/public/v2/download/{noticeId}` | The full **eForms UBL XML** for one notice. `Content-Type: application/octet-stream`. |

**There is no JSON single-notice endpoint.** `/public/v2/notices/{id}`, `/public/v2/notice/{id}`,
`/public/v2/search/{id}` and `/public/v2/eforms/{id}` all `404` **[verified]**. To get one notice as JSON you must
search for it; to get full detail you must use the XML download.

`betaapi.doffin.no` also hosts `/public/v2/search` but rejects our key with `401` **[verified]** — it is a separate
subscription. **Do not point the adapter at it.**

Public web URL for a notice: `https://www.doffin.no/notices/{id}` **[inferred]** — the site is an SPA so every path
returns the same 1306-byte shell and the pattern cannot be confirmed by status code; it is corroborated by
search-engine-indexed real notice URLs (e.g. `https://www.doffin.no/notices/2024-110265`). The API's own
`doffinClassicUrl` field was `null` in all 1000 sampled notices, so it cannot be used to derive `sourceUrl`.

---

## 3. Query parameters

Determined by differential testing: a parameter is real only if a bogus value changes the response
(error, or a drop in `numHitsTotal`). Baseline `numHitsTotal` = **157143**.

### Real parameters [verified]

| Parameter | Type / format | Notes |
|---|---|---|
| `numHitsPerPage` | int | Page size. **1000 accepted and honoured** (returned 1000 hits). No upper bound found below that. |
| `page` | int, **1-indexed** | `page=0` → `400 {"reason":"Parameter page must be >= 1"}`. |
| `sortBy` | enum | See §4. Invalid value → `404` with an empty body. |
| `searchString` | string | Free-text. `searchString=skole` → 10101 hits. |
| `cpvCode` | 8-digit CPV | Hierarchical: `cpvCode=45000000` → 41820 hits, so a division code matches its descendants. |
| `location` | NUTS code | `location=NO081` → 9276 hits. |
| `type` | enum `NoticeType` | Accepts both concrete types and category roll-ups. See §5. |
| `status` | enum `NoticeStatus` | `ACTIVE` (1578), `EXPIRED` (77612), `CANCELLED` (1732). |
| `issueDateFrom` | `YYYY-MM-DD` | Inclusive lower bound on `issueDate`. Bad format → `400 {"reason":"Wrong issue date format. Correct format: YYYY-MM-DD"}`. |
| `issueDateTo` | `YYYY-MM-DD` | Upper bound on `issueDate`. |

### Confirmed NOT to exist [verified]

`publicationDateFrom`, `publicationDateTo`, `deadlineFrom`, `deadlineTo`, `modifiedFrom`, `modifiedAfter`,
`modificationDateFrom`, `modifiedDateFrom`, `lastModified`, `updatedAfter`, `updatedFrom`, `changedFrom`,
`query`, `q`, `text`, `freeText`, `search`, `keyword`, `cpv`, `cpvCodes`, `locationId`, `nuts`, `buyer`,
`organizationId`, `pageSize`, `pageNumber`, `id`.

> ### Trap: unknown parameters are silently ignored
>
> An unrecognised parameter returns **`200` with the full unfiltered result set** — no error, no warning.
> `?id=2026-112546` returns `numHitsTotal: 157143`, i.e. everything, while *looking* like it worked because the
> requested notice happened to be on page 1. A typo in a filter name will silently widen the query to the entire
> database rather than fail. **The adapter must assert `numHitsTotal` actually dropped when a filter is applied**,
> and must never build query strings from unvalidated field names.

---

## 4. Pagination and the 1000-hit ceiling

Response envelope **[verified]**:

```json
{ "numHitsTotal": 157143, "numHitsAccessible": 1000, "hits": [ ... ] }
```

- `numHitsTotal` — matches in the whole database.
- `numHitsAccessible` — `min(numHitsTotal, 1000)`. With `issueDateFrom=2026-08-01` it returned `28`, equal to
  `numHitsTotal` **[verified]**.
- Page-number pagination. **No cursor and no continuation token.**

**Hard cap: you cannot read past the top 1000 hits of any query** **[verified]**:

```
GET /public/v2/search?numHitsPerPage=2&page=501
400 {"reason":"Unable to access more than the top 1000 hits, please lower either the page or numHitsPerPage parameters."}
```

The cap is on `page × numHitsPerPage`, so a bigger page size does not help. **The only way to reach more than 1000
notices is to partition the query** — by `issueDateFrom`/`issueDateTo` window, `type`, `cpvCode` or `location`.

### `sortBy` — complete verified enum

Every other value tested returned `404`.

| Value | Behaviour |
|---|---|
| `PUBLICATION_DATE_DESC` | Newest first. Same result as the default. |
| `PUBLICATION_DATE_ASC` | Oldest first (returned notices from 2017-01-02). |
| `DEADLINE` | Ascending by deadline. No `DEADLINE_DESC`. |
| `RELEVANCE` | Default when `searchString` is used. |
| `ESTIMATED_VALUE_DESC` | Descending by estimated value. |

**Default sort (no `sortBy`) is publication date descending** **[verified]** — monotonically non-increasing
across all 1000 sampled hits.

**Not available: any sort by issue date or by modification date.** `ISSUE_DATE_ASC/DESC`,
`MODIFICATION_DATE_DESC`, `MODIFIED_DATE_DESC`, `UPDATED_DATE_DESC` all `404` **[verified]**.

### Pagination stability

- Two identical calls returned hits in **identical order** **[verified]** — ordering is deterministic for a
  fixed query.
- But paging is **not consistent across different page sizes**: `numHitsPerPage=25` pages 1+2 versus
  `numHitsPerPage=50` page 1 covered overlapping-but-different sets — 5 of the 50 were missing from the two
  25-item pages **[verified]**. `publicationDate` has only day granularity and the intra-day tie-break is not by
  `id` and is not documented.

  **Consequence: never treat a page boundary as a clean cut.** Fix the page size for a whole paging run, dedupe by
  `id`, and use an overlapping window.

---

## 5. Notice-type taxonomy — the real code values

This is what the deterministic `noticeCategory` derivation in spec §13 should key on.

### 5a. JSON: `type` and `allTypes`

Every hit carries a single `type` and an `allTypes` array **[verified]**. `allTypes` contains the concrete type
plus **category roll-up tags**, which map almost directly onto spec §13's `noticeCategory`.

Frequencies from a 1000-notice sample (notices published 2026-06-30 → 2026-08-03), with whole-database counts
from `type=` filtered queries:

| `type` value | in sample | whole DB | Norwegian name | roll-up tags seen in `allTypes` |
|---|---|---|---|---|
| `ANNOUNCEMENT_OF_COMPETITION` | 623 | 100362 | konkurransekunngjøring | `COMPETITION` (always) |
| `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT` | 219 | 31122 | tildelingskunngjøring | `RESULT` (always) |
| `ADVISORY_NOTICE` | 93 | 12951 | veiledende kunngjøring | `PLANNING` (always) |
| `CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT` | 35 | — | avlyst/manglende kontraktinngåelse | `RESULT` (always) |
| `ANNOUNCEMENT_OF_INTENT` | 20 | 3687 | intensjonskunngjøring | `RESULT` (always) |
| `DYNAMIC_PURCHASING_SCHEME` | 8 | — | dynamisk innkjøpsordning | `COMPETITION` (always) |
| `PRE_ANNOUNCEMENT` | 1 | — | forhåndskunngjøring | `COMPETITION` |
| `NOTICE_ON_BUYER_PROFILE` | 1 | — | kunngjøring på kjøperprofil | `PLANNING` |

Roll-up tags usable as `type=` filter values: `COMPETITION` (101489), `RESULT` (42667), `PLANNING` (13012)
**[verified]**.

> ### Trap: `ANNOUNCEMENT_OF_INTENT` rolls up to `RESULT`, not `PLANNING`
>
> Spec §13 requires intensjonskunngjøringer to become `noticeCategory: "planned"`. But Doffin tags them
> `RESULT` — the same roll-up as an actual award **[verified, 20/20 in sample]**. **Deriving `noticeCategory`
> from `allTypes` alone would misclassify every intensjonskunngjøring as an award.** Derive from the concrete
> `type` field.

> ### Trap: `allTypes` is not a clean partition
>
> 24 of 623 `ANNOUNCEMENT_OF_COMPETITION` notices also carried `PLANNING` **and** `NOTICE_ON_BUYER_PROFILE`;
> 3 of 35 `CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT` carried `ADVISORY_NOTICE`/`PLANNING` **[verified]**.
> A notice can be tagged both `PLANNING` and `COMPETITION`. Only `type` is single-valued.

### 5b. Recommended `noticeCategory` derivation

Key on the single-valued `type` field, and fail loudly on anything unrecognised:

| `type` | `noticeCategory` |
|---|---|
| `ADVISORY_NOTICE`, `PRE_ANNOUNCEMENT`, `NOTICE_ON_BUYER_PROFILE`, `ANNOUNCEMENT_OF_INTENT` | `planned` |
| `ANNOUNCEMENT_OF_COMPETITION`, `DYNAMIC_PURCHASING_SCHEME` | `competition` |
| `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT`, `CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT` | `award` |
| anything else | `other` + `console.warn` the unknown value |

The enum is server-side Java (`no.dfo.dof.notices.domain.elements.NoticeType`, leaked in a `400` body) and can
gain values without notice, so the default branch must be loud.

### 5c. XML: eForms notice subtype codes

`GET /public/v2/download/{id}` returns eForms UBL. The discriminator is
`cbc:NoticeTypeCode`, whose `listName` attribute gives the eForms form type and whose value gives the subtype
**[verified]**:

| Doffin `type` | XML root element | `cbc:NoticeTypeCode` |
|---|---|---|
| `ADVISORY_NOTICE` | `PriorInformationNotice` | `listName="planning"` → `pin-only` |
| `ANNOUNCEMENT_OF_COMPETITION` | `ContractNotice` | `listName="competition"` → `cn-standard` |
| `ANNOUNCEMENT_OF_INTENT` | `ContractAwardNotice` | `listName="dir-awa-pre"` → `veat` |
| `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT` | `ContractAwardNotice` | `listName="result"` → `can-standard` |
| `CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT` | `ContractAwardNotice` | `listName="result"` → `can-standard` |

> **The XML root element cannot distinguish notice types.** Intensjonskunngjøring, tildelingskunngjøring and
> cancelled-contract notices are all `ContractAwardNotice` **[verified]**. Only `cbc:NoticeTypeCode/@listName`
> separates `veat` from `can-standard`; and `can-standard` does **not** separate a real award from a cancellation
> — for that you need the JSON `type`.

`cbc:CustomizationID` observed as `eforms-sdk-1.13#extended#urn:fdc:anskaffelser.no:2023:eforms:eu` and
`...:national` **[verified]** — the `:eu` / `:national` suffix distinguishes EEA-threshold from
national-threshold procurements, matching `cbc:RegulatoryDomain` (`32014L0024` vs `other`).

---

## 6. Incremental sync — the critical answer

### There is no modified-after filter, and no modified timestamp at all.

This is the headline finding and it **invalidates the sync design in spec §12**.

**[verified]** across a 1000-notice sample, every hit has exactly these 18 keys and no others:

```
id, buyer, heading, description, locationId, estimatedValue, type, allTypes, status,
issueDate, deadline, publicationDate, receivedTenders, allReceivedTenders, cpvCodes,
limitedDataFlag, doffinClassicUrl, lots
```

There is **no** `modifiedAt`, `lastModified`, `updatedAt`, `changedAt` or equivalent — not in the JSON, not as a
filter, not as a sort key. The eForms XML has `cbc:IssueDate`/`cbc:IssueTime` and `cbc:VersionID`, but no
modification timestamp either.

**Spec §13's `Tender.modifiedAt` cannot be populated from Doffin.** It must be left undefined, or repurposed to
mean "when our own ingest last saw a change".

### What is available instead

Two date fields, both **[verified]**:

| Field | Format | Meaning |
|---|---|---|
| `issueDate` | `2026-07-30T12:36:32Z` — full UTC timestamp | When the buyer issued the notice. Filterable via `issueDateFrom`/`issueDateTo` at **day** granularity only. Not sortable. |
| `publicationDate` | `2026-08-03` — **date only, no time** | When Doffin published it. Sortable (`PUBLICATION_DATE_ASC/DESC`), default sort. **Not filterable.** |

Note the awkward split: **the filterable field is not sortable and the sortable field is not filterable.**

`publicationDate ≥ issueDate` in all 1000 samples, never negative **[verified]**. The lag distribution:

| lag (days) | 0 | 1 | 2 | 3 | 4 | 5 | 7 |
|---|---|---|---|---|---|---|---|
| notices | 59 | 628 | 140 | 103 | 68 | 1 | 1 |

**A notice can be published up to 7 days after it was issued** **[verified]**. So an `issueDate` watermark will
miss late-published notices that were issued before the watermark.

Volume: ~32 notices per publication day on average, max 99 in one day, over 31 days **[verified]**.

### Recommended sync strategy

**Watermark on `publicationDate`, not `issueDate`, and not `modifiedAt`.**

1. Query `GET /public/v2/search?sortBy=PUBLICATION_DATE_DESC&numHitsPerPage=100&page=N`.
2. Page forward until `publicationDate < watermark − overlap`. With an overlap of **10 days**, that safely covers
   the observed 7-day maximum issue→publication lag and any same-day tie-break churn.
3. At ~32 notices/day, a 10-day overlap is ~320 notices — comfortably inside the 1000-hit ceiling, and well inside
   it even at the observed 99/day peak.
4. Fix `numHitsPerPage` for the whole run and **dedupe by `id`** (page boundaries shift between page sizes, §4).
5. Advance the watermark only after the whole run persists successfully, as spec §12 already requires.

If a backfill ever needs more than 1000 notices, partition with `issueDateFrom`/`issueDateTo` day windows —
`issueDateFrom=2026-07-01&issueDateTo=2026-07-31` returned 939 hits, so roughly a **month per window** is the
practical maximum, and a week is safer.

### Change detection is structurally different from what the spec assumes

A correction is **not** an update to an existing notice. It is published as a **brand-new notice with a new
Doffin `id` and a new eForms UUID**, carrying a back-reference to the notice it supersedes **[verified]** on
notice `2026-111809`:

```xml
<efac:Changes>
  <efbc:ChangedNoticeIdentifier>31ee646a-d4df-4ca5-a1ef-5241be87f845-01</efbc:ChangedNoticeIdentifier>
  <efac:Change><efac:ChangedSection>
    <efbc:ChangedSectionIdentifier>LOT-0000</efbc:ChangedSectionIdentifier>
  </efac:ChangedSection></efac:Change>
</efac:Changes>
```

`cbc:VersionID` was `01` on **every** notice examined, including this corrected one **[verified]** — it is not a
revision counter you can use.

Consequences for spec §13's "vesentlige endringer" (deadline changed, cancelled, CPV changed, …):

- **The back-reference is only in the XML.** `efac:Changes` and `cbc:ContractFolderID` have no JSON equivalent.
  Detecting that notice B supersedes notice A therefore requires an **extra XML download per notice** — roughly
  one extra request for each of ~32 notices/day.
- **The link is by eForms UUID, not Doffin id.** `ChangedNoticeIdentifier` is `{uuid}-{version}`, while the JSON
  `id` is `2026-112541`. To resolve a correction you must persist the XML's
  `cbc:ID schemeName="notice-id"` UUID alongside the Doffin `id` for every notice ingested. **If the adapter does
  not store this UUID from day one, correction-linking cannot be built later without a full re-ingest.**
- `cbc:ContractFolderID` (a UUID, present on most but not all notices — absent on the sampled `ADVISORY_NOTICE`
  **[verified]**) is the other way to group notices about the same procurement, including linking a planned
  notice to the competition that follows it (spec §13's last "vesentlig endring"). Also XML-only.
- **[unverified]** Whether the superseded notice is removed from, or remains in, the search index. Not tested —
  it needs observation over time. This matters: if both remain, the digest could show a stale duplicate.

**Recommendation:** persist `noticeUuid` and `contractFolderId` from the XML for every ingested notice, even in
MVP where correction-linking is not yet a feature. They are cheap to store and impossible to backfill.

---

## 7. Rate limits and errors

**[verified]** by one controlled burst of minimal (`numHitsPerPage=1`) requests:

- **28 successful requests, then `429`** after ~7.7 seconds.
- The `429` carries a **`Retry-After` header in seconds** (observed value `4`) and a body:
  `{"statusCode": 429, "message": "Rate limit is exceeded. Try again in 4 seconds."}`
- Normal service resumed ~6 s later.
- **[inferred]** roughly 30 requests per 10-second window. The exact policy is not published; treat the numbers as
  the observed shape, not a contract.

**No quota headers.** No `X-RateLimit-Limit`, `X-RateLimit-Remaining` or `X-RateLimit-Reset` in any response
**[verified]**. `Retry-After` appears only on `429`. Response headers are otherwise unremarkable
(`content-type`, `date`, `strict-transport-security`, `x-content-type-options`, `x-frame-options`,
`request-context`, `referrer-policy`, `x-ms-middleware-request-id`).

**The adapter must honour `Retry-After` and retry with backoff.** A sync run that downloads XML per notice will
hit this limit immediately at any concurrency.

### Error shapes — two different formats

The gateway and the application produce **structurally different** error bodies. Both must be parsed.

| Status | Source | Body |
|---|---|---|
| `401` | APIM gateway | `{"statusCode": 401, "message": "Access denied due to invalid subscription key..."}` |
| `404` | APIM gateway (no such path) | `{"statusCode": 404, "message": "Resource not found"}` |
| `429` | APIM gateway | `{"statusCode": 429, "message": "Rate limit is exceeded. Try again in N seconds."}` |
| `400` | application | `{"reason": "Parameter page must be >= 1"}` |
| `400` | application | `{"reason": "Wrong issue date format. Correct format: YYYY-MM-DD"}` |
| `400` | application | `{"reason": "Unable to access more than the top 1000 hits, please lower either the page or numHitsPerPage parameters."}` |
| `400` | application (enum) | `{"reason": "No enum constant no.dfo.dof.notices.domain.elements.NoticeType.ZZZBOGUS"}` |
| `404` | application (bad `sortBy`) | **empty body** |

Gateway errors use `statusCode` + `message`; application errors use `reason`. A bad `sortBy` gives a bodiless
`404` that is indistinguishable from a wrong URL — worth a specific guard.

---

## 8. Phase-8 gate (spec §54 step 7): do award notices expose supplier and contract duration?

**Answer: PARTIALLY. Supplier name — yes, reliably. Contract duration / end date — no, mostly absent.**

### (a) Winning supplier name — **YES** [verified]

Already resolved for us in the **JSON** search response, no XML needed:

```jsonc
"lots": [
  {
    "heading": "Kontraktstildeling - Kontaktsenterløsning til Digitaliseringsdirektoratet",
    "description": "...",
    "winner": [
      { "id": "de602c4b6314c7d7a75b6b3c46b33004", "organizationId": "890164072", "name": "Globalconnect AS" }
    ]
  }
]
```

- Field path: `hits[].lots[].winner[].name`, with `.organizationId` (Norwegian org number) and an opaque `.id`.
- **219 of 219** `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT` notices in the sample had at least one lot winner
  **[verified]** — 100% coverage.
- `winner` is an array per lot, so multi-lot awards and consortia are representable.
- **`winner` is also populated on intensjonskunngjøringer** — 20/20 `ANNOUNCEMENT_OF_INTENT` notices carry one
  **[verified]**, because a VEAT names the supplier the buyer intends to award to without competition. Presence of
  a winner therefore does **not** imply an award; see `fixtures/edge-cases.md`. It also means phase 8 can surface
  intended suppliers, not just concluded ones.
- `CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT` notices have **0/35** winners **[verified]** — a useful signal for
  separating a real award from a cancellation once `type` has been checked.
- In the XML this requires walking
  `LotResult → LotTender → TenderingParty → Tenderer → ORG-nnnn` and resolving against `efac:Organizations`.
  **The JSON pre-resolves this.** Use the JSON.

Bonus, XML-only: the actual awarded amount, `efac:LotTender/cac:LegalMonetaryTotal/cbc:PayableAmount`
(e.g. `3529420 NOK`), which differs from the JSON `estimatedValue.amount` (`4000000 NOK`) **[verified]**.

### (b) Contract duration / end date — **NO** [verified]

- **Not present anywhere in the JSON.** No `duration`, `endDate`, `startDate`, `period` or `contractEnd` key
  exists in any of the 1000 sampled hits.
- In the XML, only **2 of 10** award notices examined carried
  `cac:ProcurementProject/cac:PlannedPeriod` **[verified]**. When present it was `cbc:StartDate` + `cbc:EndDate`
  (e.g. `2025-08-01Z` → `2025-12-19Z`), never a `DurationMeasure`.
- What *is* consistently present on awards is
  `efac:SettledContract/cbc:IssueDate` — the contract **conclusion** date (e.g. `2026-07-31Z`) **[verified]**.
  That is when the contract was signed, **not** when it ends.

> ### Correction to my own first reading
>
> My initial pass reported contract durations on competition notices as `6 MONTH` / `90 DAY`. That was **wrong** —
> it matched the first `cbc:DurationMeasure` in the document, which is
> `cac:TenderValidityPeriod/cbc:DurationMeasure` (how long a bid stays valid). The contract duration is
> `cac:ProcurementProject/cac:PlannedPeriod/cbc:DurationMeasure`, which on the same notice was `48 MONTH`
> **[verified]**. Any implementation extracting duration **must scope the XPath to `PlannedPeriod`** or it will
> silently record bid-validity periods as contract lengths.

### Verdict for the phase-8 decision

A "who won, and what did they win" feature is **buildable** — supplier name, org number, awarded amount and
contract signature date are all reliably available.

A "when does this contract come up for renewal" feature is **not buildable from Doffin award notices** — the end
date is missing ~80% of the time. The one workaround: **contract duration is reliably present on the *competition*
notice** (`cac:PlannedPeriod/cbc:DurationMeasure`, 48 MONTH in the sampled `cn-standard`), so an end date could be
*estimated* as `SettledContract/IssueDate + PlannedPeriod duration from the linked contract notice`. That requires
the `ContractFolderID` linkage from §6 — another reason to store it from day one.

Spec §13's instruction to preserve raw award data in `rawPayload` is sound and sufficient **for supplier data**.
It is not sufficient for duration, because the duration mostly is not in the payload at all.

---

## 9. Field mapping for the normalised `Tender` model (spec §13)

Source paths are relative to a search hit (`hits[]`) unless marked **XML**, which means
`GET /public/v2/download/{id}`.

Presence percentages are from the 1000-notice sample **[verified]**.

| `Tender` field | Source path | Always present? | Format / notes |
|---|---|---|---|
| `source` | — | n/a | Constant `"doffin"`. |
| `sourceId` | `id` | **Yes** 1000/1000 | `"2026-112541"` — `YYYY-NNNNNN`, all 1000 matched `^\d{4}-\d+$`. Unique within a page. |
| `noticeId` | **XML** `cbc:ID[@schemeName="notice-id"]` | Yes in XML | eForms UUID, e.g. `9fa89bc7-d855-46a0-9c48-7bbd7e1065c9`. **Not in JSON.** Store it — §6 explains why. |
| `sourceUrl` | — | n/a | **Must be constructed**: `https://www.doffin.no/notices/{id}` **[inferred]**. `doffinClassicUrl` is `null` in 1000/1000. |
| `title` | `heading` | **Yes** 1000/1000 | Norwegian text, UTF-8. |
| `description` | `description` | **Yes** 1000/1000 | Never null in the sample. May contain embedded newlines, `«»` quotes, and sometimes a contact block with a personal name and e-mail — see edge cases. |
| `buyerName` | `buyer[0].name` | **Yes** 1000/1000 | `buyer` is an **array**; 74/1000 notices had more than one buyer. Picking `[0]` loses co-purchasers. |
| `buyerOrganizationNumber` | `buyer[0].organizationId` | **Yes** 1000/1000 | Never null, but **not always a 9-digit Norwegian org number** — observed string lengths 3, 9, 11, 17 and 49 (foreign buyers). Do not validate as 9 digits. |
| `cpvCodes` | `cpvCodes` | **Yes** 1000/1000, never empty | Array of **8-digit** strings, all 1000 uniformly 8 chars. Up to **86** codes on one notice. |
| `regions` | `locationId` | Present, 2/1000 empty arrays | NUTS codes: `NO081`, `NO0A2`, `NOZZZ` (unspecified), and the special value **`anyw`** (= anywhere/nationwide, 182/1000). `anyw` is not a NUTS code and must be special-cased. Foreign NUTS also occur (`FI1D9`). |
| `municipalities` | **NOT AVAILABLE** | — | **Gap.** There is no municipality field. `locationId` is NUTS-3 at finest, which is county-level, not municipality. The XML has `cbc:CityName`, but that is the *buyer's postal city* (`TOLVSRØD`, `BÆRUM`), not the place of performance — using it as `municipalities` would be wrong. **Spec §13 `municipalities` cannot be populated from Doffin.** |
| `noticeType` | `type` | **Yes** 1000/1000 | 8 observed values, §5a. |
| `noticeCategory` | derived from `type` | — | See §5b. |
| `procedureType` | **XML** `cbc:ProcedureCode[@listName="procurement-procedure-type"]` | **XML only** | Observed `open`, `neg-wo-call`. **Not in JSON** — populating this costs one XML download per notice. Absent entirely on `ADVISORY_NOTICE`. |
| `estimatedValueMinNok` / `MaxNok` | `estimatedValue.amount` | **No** — null in **530/1000** | A **single scalar, not a range**. Spec §13's min/max pair has no source: set both to the same value, or use only one. 47% of notices have no value at all. |
| `currency` | `estimatedValue.currencyCode` | With the above | Observed `NOK` and **`PLN`** — not always NOK. **Conversion is required before comparing against a NOK threshold**, and no rate is supplied by the API. |
| `publishedAt` | `publicationDate` | **Yes** 1000/1000 | **Date only, `"2026-08-03"` — no time component.** Coercing to a `Date` implies midnight; pick a timezone convention explicitly. |
| `modifiedAt` | **NOT AVAILABLE** | — | **Gap.** See §6. Nothing in the API corresponds to this. |
| `deadlineAt` | `deadline` | **No** — null in **309/1000** | ISO-8601 UTC with `Z`, e.g. `"2026-09-01T10:00:00Z"`. Null-rate is strongly type-dependent: `ADVISORY_NOTICE` 93/93 null, `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT` 165/219 null, but `ANNOUNCEMENT_OF_COMPETITION` only 4/623 null. |
| `status` | `status` | **No** — null in **396/1000** | Values `ACTIVE`, `EXPIRED`, plus `CANCELLED` (filterable, 1732 in DB, absent from the sample). **Null for 100% of award, intent, advisory and cancelled-contract notices** — status is only populated for live competitions. Mapping to spec's `"open"|"closed"|"cancelled"|"awarded"|"unknown"` must derive from `type` when `status` is null. |
| `sourceRevision` | **XML** `cbc:VersionID` | XML only | **Useless as a revision** — `01` on every notice examined, including a corrected one. Prefer `efac:Changes/efbc:ChangedNoticeIdentifier`. |
| `sourcePayloadHash` | — | n/a | Compute over the hit object. |
| `rawPayload` | the whole hit | — | 18 stable keys. |

### Status derivation when `status` is null

`status` is null for every non-competition notice **[verified]**, so spec §13's `status` must be derived:

| Condition | `Tender.status` |
|---|---|
| `type` = `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT` | `awarded` |
| `type` = `CANCELLED_OR_MISSING_CONCLUSION_OF_CONTRACT` | `cancelled` |
| `status` = `ACTIVE` | `open` |
| `status` = `EXPIRED` | `closed` |
| `status` = `CANCELLED` | `cancelled` |
| planned types (advisory / pre-announcement / intent / buyer-profile) | `unknown` (they have no competition state) |
| otherwise | `unknown` + warn |

### Fields the API offers that spec §13 does not model

Worth keeping in `rawPayload`, and possibly promoting:

- `lots[]` — `heading`, `description`, `winner[]`. Multi-lot notices are common (64/1000, up to **14 lots**).
- `receivedTenders` (int, null in 726/1000) and `allReceivedTenders[]` — breakdown by submission type, e.g.
  `[{"type":"tenders","total":0},{"type":"t-esubm","total":3}]`. Useful competitive-intensity signal.
- `limitedDataFlag` and `doffinClassicUrl` — **null in 1000/1000**. Legacy; ignore, but do not assume they will
  always be null.

---

## 10. Summary of gaps against the spec

| Spec expectation | Reality | Impact |
|---|---|---|
| §12 incremental sync on a "modified after" watermark | **No modified field, filter or sort exists** | Redesign around a `publicationDate` watermark with a ≥10-day overlap (§6). |
| §13 `modifiedAt` | Not available | Leave undefined or redefine as ingest-local. |
| §13 `municipalities` | Not available; NUTS only, county-level | Cannot be populated. Geography matching must work at NUTS-3, and must handle `anyw`. |
| §13 `estimatedValueMinNok`/`MaxNok` as a range | Single scalar, absent 47% of the time | Both bounds get the same value; matching must tolerate a missing value. |
| §13 `procedureType` | XML only | One extra request per notice, or leave undefined in MVP. |
| §13 change detection ("vesentlige endringer") | Corrections arrive as **new notices**, linked only in XML by eForms UUID | Must store `noticeUuid` + `contractFolderId` from day one or lose the ability retroactively. |
| §13 planned→competition linking | Only via `ContractFolderID`, XML-only | Same as above. |
| §54 step 7 award data | Supplier **yes**, duration **no** (~80% missing) | Renewal-timing feature not buildable as specified; supplier feature is. |
| §13 `noticeCategory` from notice type | Works, but **`ANNOUNCEMENT_OF_INTENT` rolls up to `RESULT`** | Derive from `type`, never from `allTypes`. |

---

## 11. Reproducing this

Scripts used were written to a scratchpad outside the repo and are not committed. Every result above can be
reproduced with:

```bash
curl -s -H "Ocp-Apim-Subscription-Key: $DOFFIN_SUBSCRIPTION_KEY" \
  "https://api.doffin.no/public/v2/search?numHitsPerPage=1000&page=1"

curl -s -H "Ocp-Apim-Subscription-Key: $DOFFIN_SUBSCRIPTION_KEY" \
  "https://api.doffin.no/public/v2/download/2026-112546"
```

Be polite: the rate limit is ~30 requests per 10 seconds and there is no quota header to steer by.
