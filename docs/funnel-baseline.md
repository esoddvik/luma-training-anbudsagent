# The funnel baseline, written down before it ships

IDE Agent Spec v3 section 3.2 requires the baseline expectation to be recorded **before** Fase B deploys. This document is that record. It is written on 2026-08-09, with the funnel instrumented and nothing yet released.

The reason for writing it first is not ceremony. Once real numbers exist, any figure can be narrated into a success — a 3% signup rate is "encouraging early traction" or "a serious problem" depending entirely on what you expected, and nobody remembers what they expected. Committing the expectation to a file makes the comparison honest by making it possible to be wrong.

## What the old funnel converted

**Nothing. Literally zero.**

Before the search-first entry door, `/anbudsvarsling` carried an email field whose form posted to `#registrering` — an anchor on the same page. There was a `TODO(auth)` comment above it. Anyone who typed an address and pressed the button got the same page back and no account, and no event was recorded anywhere because there was nothing to record.

So the baseline is not "the old form converted at some rate we must beat". It is that **no signup was possible through the product at all**. Any completed signup is an improvement over the previous state, which means "we beat the baseline" is worthless as a claim and must not be made.

## What to compare instead

The honest comparison is **internal to the new funnel**: where do people leave? Those ratios are meaningful on day one, need no historical baseline, and are what the instrumentation was built to answer.

The seven events, in order, from `funnel_events`:

```
picker_viewed → trade_selected → region_selected → results_viewed
              → signup_started → signup_completed → profile_activated
```

### Expectations, stated as ranges with reasons

These are predictions, not targets. They are deliberately wide, because a narrow guess dressed as a forecast is how a number gets defended instead of examined.

| Step | Expected | Why this number |
| --- | --- | --- |
| `picker_viewed` → `trade_selected` | **40–70%** | Eight clear options and no cost to clicking. Below 40% suggests the eight service templates do not describe what visitors actually sell — an editorial problem, not a UX one. |
| `trade_selected` → `results_viewed` | **~100%** | They are the same page render. A gap here means the beacon is broken, not that people left. **Treat any material gap as an instrumentation bug first.** |
| `results_viewed` → `signup_started` | **5–15%** | The one genuinely uncertain number. This is a stranger deciding to give an email address after seeing real notices. Below 5% and the results are not convincing enough — most likely too few, which points back at the density thresholds. |
| `signup_started` → `signup_completed` | **50–75%** | Email confirmation always loses people: spam folders, abandoned tabs, wrong addresses. Below 50% and suspect deliverability before design. |
| `signup_completed` → `profile_activated` | **30–60%** | Profiles are created paused on purpose, so this step requires a second, later, deliberate action. This is the step most likely to disappoint, and the one where "leave it paused" is a defensible product answer rather than a failure. |

### The number that would actually mean something

`results_viewed → signup_started`, segmented by service template slug. Every event carries the slug precisely so this is a `GROUP BY`. A trade that draws visitors and converts none of them is either mis-described or genuinely poorly served by the corpus, and those two have different fixes.

## What this measurement cannot tell you

**Nothing about individual journeys.** `funnel_events` deliberately holds no visitor identifier — no cookie, no session key, no address hash. So these are *rates over populations*, not paths. You can say "the region step loses a third of everyone who reaches it". You cannot say "this visitor bounced at the region step". That was a deliberate trade against tracking anonymous people across a public page; see the note on `funnel_events` in `packages/db/src/schema/funnel.ts`.

**Nothing before the picker.** Traffic arriving on `/anbud-for/...` directly from a search engine never sees `/finn-anbud`, so it appears as `trade_selected` with no preceding `picker_viewed`. Once SEO works at all, `picker_viewed` stops being the denominator for anything and the funnel must be read from `trade_selected` onward. **Expect this to happen and do not read it as a collapse in picker interest.**

**Nothing about quality.** A signup is not a customer. The event that matters commercially is course attribution, which lives in `attribution_events` and is deliberately a separate table (ADR-6).

## How to check it

```sql
select type, service_template_slug, count(*)
from funnel_events
where occurred_at > now() - interval '30 days'
group by 1, 2
order by 1, 3 desc;
```

Compare against the table above. Where reality lands outside a range, write down which way and why — in this file, under a dated heading. A prediction that is quietly revised after the fact is not a prediction.
