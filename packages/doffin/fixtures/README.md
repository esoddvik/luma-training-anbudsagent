# Doffin fixtures

Real payloads captured from the live Doffin production API. See `docs/doffin-api-findings.md` for the full
API write-up, and `edge-cases.md` in this directory for the things that will bite the implementation.

**All captured 2026-08-03.**

## Provenance

| File | Notice id | Doffin `type` | Endpoint |
|---|---|---|---|
| `prior-information-notice.json` | `2026-112539` | `ADVISORY_NOTICE` (veiledende kunngjøring) | `GET https://api.doffin.no/public/v2/search` |
| `intention-notice.json` | `2026-112480` | `ANNOUNCEMENT_OF_INTENT` (intensjonskunngjøring) | `GET https://api.doffin.no/public/v2/search` |
| `contract-notice.json` | `2026-112541` | `ANNOUNCEMENT_OF_COMPETITION` (konkurransekunngjøring) | `GET https://api.doffin.no/public/v2/search` |
| `contract-award-notice.json` | `2026-112546` | `ANNOUNCEMENT_OF_CONCLUSION_OF_CONTRACT` (tildelingskunngjøring) | `GET https://api.doffin.no/public/v2/search` |
| `search-response-page.json` | — | — | `GET https://api.doffin.no/public/v2/search?numHitsPerPage=3&page=2` |
| `eforms-xml-fields.json` | six notices | mixed | `GET https://api.doffin.no/public/v2/download/{id}` |

## What each file contains

**The four notice-type files are a single `hits[]` element**, unwrapped — the exact object shape the normaliser
will receive, ready to feed straight into a unit test. They are byte-faithful to the API apart from the
sanitisation noted below.

**`search-response-page.json`** is a complete, unmodified response envelope, captured from **page 2** with
`numHitsPerPage=3` specifically so the pagination shape is visible:

```json
{ "numHitsTotal": 157143, "numHitsAccessible": 1000, "hits": [ ... ] }
```

Note `numHitsAccessible` is capped at 1000 regardless of `numHitsTotal` — the API refuses to page beyond the top
1000 hits of any query.

**`eforms-xml-fields.json`** is **not** a raw capture. It is a hand-transcribed extract of the fields that exist
only in the eForms UBL XML from `/public/v2/download/{id}` and have no JSON equivalent: the eForms notice-subtype
code, `procedureType`, contract duration, and the correction back-reference. It is included because an adapter
built from the JSON alone cannot populate `procedureType` or link corrections, and those decisions need the real
values in front of them. The raw XML itself is not committed — it is large and contains contact details.

## Sanitisation

**Rule applied:** keep all real public procurement data (buyer names, organisation numbers, values, CPV codes,
dates, supplier names — this is public data by law), strip anything resembling a personal contact detail.

- E-mail addresses → `kontakt@example.no`
- Phone-like digit runs, where surrounding text mentions `tlf`/`telefon`/`mobil`/`kontakt` → `00 00 00 00`
- Individual contact-person names → `Kontaktperson`

**What was actually changed in these files: nothing.**

All four chosen notices and the captured page were scanned and contained **no** personal contact details, so they
are byte-faithful captures. The sanitiser was verified to work against a positive control before being trusted —
it correctly rewrote `Kontakt Ola Nordmann, tlf 22 33 44 55, e-post ola.nordmann@kommune.no`, so the "nothing
found" result is a real negative, not a broken check.

This is worth stating plainly because **other Doffin notices do contain personal data**: 11 of 1000 sampled
notices had e-mail addresses embedded in the free-text `description`, several as a full contact block
(`Kontaktperson / Navn: <person> / E-post: <address>`). The four fixtures simply happen to be clean. Any code
path that renders or forwards `description` must assume personal data may be present.

## Regenerating

```bash
curl -s -H "Ocp-Apim-Subscription-Key: $DOFFIN_SUBSCRIPTION_KEY" \
  "https://api.doffin.no/public/v2/search?numHitsPerPage=3&page=2"
```

Individual notices cannot be fetched by id as JSON — **there is no single-notice JSON endpoint, and `?id=` is
silently ignored** (it returns the unfiltered result set with `200`). These fixtures were extracted from a
`numHitsPerPage=1000` page. Notices age out of the top-1000 window within roughly a month, so re-fetching these
exact ids later requires an `issueDateFrom`/`issueDateTo` window around their issue dates.
