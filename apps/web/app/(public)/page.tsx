import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, buttonClassName, Field, Input, Promotion, Stack } from '@luma/ui';
import { landsdelOf } from '@luma/domain';
import {
  ASSISTANT_LABEL,
  ASSISTANT_LINK,
  ASSISTANT_SAMPLE_ANSWER,
  ASSISTANT_SAMPLE_QUESTION,
  COVERAGE_HEADING,
  COVERAGE_TEXT,
  LANDING_FAQ,
  LANDING_FAQ_HEADING,
  LANDING_HEADING,
  LANDING_HERO_CTA,
  LANDING_HERO_REASSURANCE,
  LANDING_HERO_SECONDARY,
  LANDING_INTRO,
  LANDING_LIVE_HEADING,
  LANDING_PROMOTION_HEADING,
  LANDING_PROMOTION_LINK,
  LANDING_PROMOTION_TEXT,
  LANDING_STEPS,
  LANDING_STEPS_HEADING,
  LANDING_TRANSPARENCY_CAPTION,
  LANDING_TRANSPARENCY_SUPPORT,
  MCP_HEADING,
  MCP_TEXT,
  SERVICE_TAGLINE,
  SIGNUP_EMAIL_HINT,
  SIGNUP_EMAIL_LABEL,
  SIGNUP_HEADING,
  SIGNUP_INTRO,
  SIGNUP_SUBMIT,
  SIGNUP_TEMPLATE_HINT,
  SIGNUP_TEMPLATE_LABEL,
  TRUST_TEXT,
} from '@/content/copy';
import { FaqList } from '@/components/faq-list';
import { requestSignupAction } from '@/server/actions/registration-actions';
import { listServiceTemplateChoices } from '@/server/profiles';
import { searchPublicTenders, type PublicTenderSummary } from '@/server/public-search';
import { describeRegions, formatDate, NATIONWIDE_NB } from '@/server/format';
import { lumaUrl } from '@/lib/luma-links';
import { privacyPolicyUrl } from '@/lib/legal';
import { PRODUCTION_URL } from '@/lib/site';

export const metadata: Metadata = {
  title: {
    absolute: 'Luma Anbudsvarsling — få beskjed når relevante anbud publiseres',
  },
  description:
    'Fortell oss hvilke oppdrag virksomheten din ser etter. Luma Anbudsvarsling følger med på nye offentlige anbud på Doffin og sender deg treff som passer kriteriene dine. Gratis, fra Luma Training.',
  // Absolute rather than `'/'`. Next would resolve `'/'` against
  // `metadataBase` to `…/anbudsvarsling/`, and `trailingSlash` is off, so that
  // form is a redirect to this one — a canonical pointing at a hop.
  alternates: { canonical: PRODUCTION_URL },
};

const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/deed.no';

/**
 * The phrase lifted into the brand colour inside the h1 — luma-training.com
 * does the same with «flere anbud» in its own headline.
 *
 * It is a slice of `LANDING_HEADING`, never a rewrite of it: section 43's
 * wording is reproduced verbatim and an e2e test matches the heading's
 * accessible name against the constant. `HeroHeading` looks the phrase up at
 * render time and falls back to the plain string if it is not there, so editing
 * the copy can change how the headline looks but cannot break it.
 */
const HERO_HIGHLIGHT = 'relevante anbud';

function HeroHeading() {
  const start = LANDING_HEADING.indexOf(HERO_HIGHLIGHT);
  if (start === -1) return <>{LANDING_HEADING}</>;

  return (
    <>
      {LANDING_HEADING.slice(0, start)}
      <span className="text-primary">{HERO_HIGHLIGHT}</span>
      {LANDING_HEADING.slice(start + HERO_HIGHLIGHT.length)}
    </>
  );
}

/**
 * Rebuilt hourly rather than pinned at deploy, so a template added in admin
 * appears without a deploy (spec section 11.2). Static, never `force-dynamic`:
 * IDE Agent Spec v3 section 3.2 makes that a rule for public pages.
 */
export const revalidate = 3600;

/** The landsdel a card should name, or the nationwide phrase. */
function heroRegion(tender: PublicTenderSummary): string {
  if (tender.nationwide) return NATIONWIDE_NB;
  for (const code of tender.regionCodes) {
    const landsdel = landsdelOf(code);
    if (landsdel) return landsdel.name;
  }
  return describeRegions(tender.regionCodes);
}

/** What the third segment of a card's meta line says. */
function heroDeadline(tender: PublicTenderSummary): string {
  if (tender.noticeCategory === 'planned') return 'Planlagt anskaffelse';
  if (!tender.deadlineAt) return 'Frist ikke oppgitt';
  return `Frist ${formatDate(tender.deadlineAt)}`;
}

/**
 * Four real notices for the hero, or none at all.
 *
 * The union of every template's CPV codes, because the hero is not about one
 * trade — it is the proof that the pipeline is live, and it has to work on a
 * page that has not asked the reader anything yet.
 *
 * **There is no placeholder branch on purpose.** This page's entire argument is
 * «ekte kunngjøringer fra Doffin, ikke eksempler», and it is prerendered, so a
 * fabricated card would sit in the HTML for an hour telling a lie the page
 * itself contradicts three sections further down. An empty right-hand column is
 * the honest failure mode, and `searchPublicTenders` already returns empty
 * rather than throwing on a database-less build.
 */
async function loadHeroTenders(cpvInclude: readonly string[]): Promise<PublicTenderSummary[]> {
  if (cpvInclude.length === 0) return [];
  const result = await searchPublicTenders({ cpvInclude, now: new Date(), limit: 4 });
  return [...result.regional, ...result.nationwide]
    .sort((a, b) => b.publishedAt.getTime() - a.publishedAt.getTime())
    .slice(0, 4);
}

export default async function LandingPage() {
  // Database first, editorial seeds as the fallback — see
  // `listServiceTemplateChoices` for why the fallback is on configuration
  // rather than on error. The action re-resolves the posted slug against the
  // live table, so a forged option value cannot write arbitrary criteria into
  // a profile.
  const templates = await listServiceTemplateChoices();
  const cpvUnion = [...new Set(templates.flatMap((template) => template.cpvInclude))];
  const heroTenders = await loadHeroTenders(cpvUnion);

  return (
    <>
      <section className="bleed luma-hero">
        <div
          className={`app-shell grid items-start gap-xl py-2xl md:py-3xl ${
            heroTenders.length > 0 ? 'md:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)]' : ''
          }`}
        >
          <div className="flex flex-col gap-lg">
            <p className="eyebrow">{SERVICE_TAGLINE}</p>
            <h1 className="hero-heading">
              <HeroHeading />
            </h1>
            <p className="prose-measure m-0 text-lg text-text-muted">{LANDING_INTRO[0]}</p>
            {/* One button, one text link. The button leaves for the picker,
                which is where the funnel actually starts; the link stays on the
                page. `#registrering` is one scroll away and the header keeps a
                permanent «Kom i gang», so a third call to action here would
                only split the choice three ways. */}
            <div className="flex flex-wrap items-center gap-md">
              <Link href="/finn-anbud" className={buttonClassName({ variant: 'primary' })}>
                {LANDING_HERO_CTA}
              </Link>
              <a href="#slik-fungerer-det" className="font-semibold">
                {LANDING_HERO_SECONDARY}
              </a>
            </div>
            <p className="m-0 text-sm text-text-muted">{LANDING_HERO_REASSURANCE}</p>
          </div>

          {heroTenders.length > 0 ? (
            <div className="flex flex-col gap-sm">
              <h2 className="eyebrow text-text-muted">{LANDING_LIVE_HEADING}</h2>
              <ul className="m-0 flex list-none flex-col gap-sm p-0">
                {heroTenders.map((tender) => (
                  <li
                    key={tender.id}
                    className="luma-card luma-card--raised luma-card--interactive"
                  >
                    <Link href={`/kunngjoring/${tender.id}`} className="font-semibold">
                      {tender.title}
                    </Link>
                    <p className="m-0 mt-2xs text-sm text-text-muted">
                      {tender.buyerName} · {heroRegion(tender)} · {heroDeadline(tender)}
                    </p>
                  </li>
                ))}
              </ul>
              {/* Required by CC BY 4.0 on every surface that redistributes
                  announcement data to someone who did not ask for it themselves
                  (ADR-0018). Reads exactly `Data: Doffin/DFØ (CC BY 4.0)`. */}
              <p className="m-0 text-xs text-text-muted">
                Data: Doffin/DFØ (<Link href={LICENCE_URL}>CC BY 4.0</Link>)
              </p>
            </div>
          ) : null}
        </div>
      </section>

      <section aria-labelledby="slik-fungerer-det-tittel" id="slik-fungerer-det">
        <Stack gap="lg">
          <h2 id="slik-fungerer-det-tittel" className="page-heading">
            {LANDING_STEPS_HEADING}
          </h2>
          {/* The flex column inside each card is an inner element rather than
              the card itself: `.luma-card` ships unlayered from `@luma/ui`, so
              its `display: block` beats a Tailwind `flex` in `@layer utilities`
              no matter the specificity. Anything that would fight a primitive's
              own declaration goes on a child. */}
          <ol className="m-0 grid list-none gap-md p-0 md:grid-cols-3">
            {LANDING_STEPS.map((step, index) => (
              <li key={step.title} className="luma-card luma-card--raised">
                <div className="flex flex-col gap-xs">
                  <span
                    aria-hidden="true"
                    className="inline-flex h-[2.375rem] w-[2.375rem] items-center justify-center rounded-[var(--luma-radius-pill)] bg-primary-soft font-semibold text-primary"
                  >
                    {index + 1}
                  </span>
                  <span className="text-lg font-semibold">{step.title}</span>
                  <span className="text-sm text-text-muted">{step.body}</span>
                </div>
              </li>
            ))}
          </ol>
        </Stack>
      </section>

      <section aria-labelledby="apenhet-tittel">
        {/* The section's own name is carried by the two blocks inside it — the
            quote and the assistant panel each say what they are. A visible
            heading over both would be a label for a pairing, not for a topic. */}
        <h2 id="apenhet-tittel" className="luma-visually-hidden">
          Åpenhet og AI-verktøy
        </h2>
        <div className="grid gap-md md:grid-cols-2">
          {/* The transparency promise. `TRUST_TEXT` is spec section 43 verbatim
              and an e2e test asserts it is visible, so it is the quote itself
              rather than a paraphrase of it. */}
          <blockquote className="m-0 flex flex-col gap-sm rounded-lg bg-primary-soft p-lg">
            <p className="m-0 text-xl font-semibold leading-snug">{TRUST_TEXT}</p>
            <p className="m-0 text-sm text-text-muted">{LANDING_TRANSPARENCY_SUPPORT}</p>
            {/* A `<footer>` here would be the semantically tidy choice, and it
                is what the first version used. Chrome exposes a `<footer>`
                inside a `<blockquote>` as a `contentinfo` landmark anyway, so
                the page shipped with two of them and anyone navigating by
                landmark met a second "footer" halfway down the article. A
                caption is not a landmark; `<cite>` says what this line is. */}
            <cite className="text-sm not-italic text-text-muted">
              {LANDING_TRANSPARENCY_CAPTION}
            </cite>
          </blockquote>

          {/* The one inverted surface in the app. `bg-ink` may only carry the
              three `ink` foregrounds — every other text token in the system is
              tuned for a near-white background. */}
          <div className="flex flex-col gap-sm rounded-lg bg-ink p-lg text-ink-on">
            <p className="eyebrow m-0 text-ink-accent">{ASSISTANT_LABEL}</p>
            <h3 className="m-0 text-lg font-semibold">{MCP_HEADING}</h3>
            <p className="m-0 text-sm">{MCP_TEXT}</p>
            <div className="flex flex-col gap-xs rounded-md border border-ink-muted p-md text-sm">
              <span className="text-ink-muted">{ASSISTANT_SAMPLE_QUESTION}</span>
              <span>{ASSISTANT_SAMPLE_ANSWER}</span>
            </div>
            <p className="m-0">
              <Link href="/ai-verktoy" className="font-semibold text-ink-accent">
                {ASSISTANT_LINK}
              </Link>
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="dekning-tittel">
        <div className="flex flex-col gap-xs rounded-lg border border-line p-lg">
          <h2 id="dekning-tittel" className="section-heading">
            {COVERAGE_HEADING}
          </h2>
          <p className="m-0 text-text-muted">{COVERAGE_TEXT}</p>
        </div>
      </section>

      {/* Labelling, the «dette er informasjon om kurs» disclosure and the
          promotion surface all come from `Promotion`, so this block cannot ship
          without the section 23.4 marking. Placement is still this page's job:
          it sits after the service's own content and before the signup. */}
      <Promotion heading={LANDING_PROMOTION_HEADING}>
        <p className="m-0">{LANDING_PROMOTION_TEXT}</p>
        <p className="m-0 mt-xs">
          <a
            href={lumaUrl('/kurs/vinn-flere-anbud-med-ai', {
              medium: 'landingsside',
              campaign: 'vinn-flere-anbud-med-ai',
              content: 'promoteringsblokk',
            })}
          >
            {LANDING_PROMOTION_LINK}
          </a>
        </p>
      </Promotion>

      <section aria-labelledby="faq-tittel">
        <Stack gap="md">
          <h2 id="faq-tittel" className="page-heading">
            {LANDING_FAQ_HEADING}
          </h2>
          <FaqList items={LANDING_FAQ} />
        </Stack>
      </section>

      {/*
       * Signup, in the design's card.
       *
       * `prose-measure` caps the column so the input does not stretch the full
       * shell width — a 72rem-wide e-mail field looks like a mistake.
       */}
      <section aria-labelledby="registrering-tittel" id="registrering">
        <div className="luma-card luma-card--raised prose-measure">
          <Stack gap="md">
            <h2 id="registrering-tittel" className="page-heading">
              {SIGNUP_HEADING}
            </h2>
            <p className="m-0 text-text-muted">{SIGNUP_INTRO}</p>
            {/* Wired to `requestSignupAction` (IDE Agent Spec v3, section 3.1).
                The service template is picked here rather than after signup so
                the address and the criteria arrive together — the whole point
                of the search-first entry door. `pending_signups` holds both
                until the address is confirmed. */}
            <form action={requestSignupAction} noValidate>
              <Stack gap="md">
                <Field
                  id="tjenestemal"
                  label={SIGNUP_TEMPLATE_LABEL}
                  hint={SIGNUP_TEMPLATE_HINT}
                  required
                >
                  {(controlProps) => (
                    <select {...controlProps} name="tjenestemal" className="form-control" required>
                      {templates.map((template) => (
                        <option key={template.slug} value={template.slug}>
                          {template.name}
                        </option>
                      ))}
                    </select>
                  )}
                </Field>
                <Field id="e-post" label={SIGNUP_EMAIL_LABEL} hint={SIGNUP_EMAIL_HINT} required>
                  {(controlProps) => (
                    <Input
                      {...controlProps}
                      name="epost"
                      type="email"
                      autoComplete="email"
                      inputMode="email"
                      placeholder="navn@virksomhet.no"
                    />
                  )}
                </Field>
                {/* Sized to its label rather than to the column, so the button
                    reads as an action and not as a second input. */}
                <div className="flex">
                  <Button type="submit" variant="primary">
                    {SIGNUP_SUBMIT}
                  </Button>
                </div>
              </Stack>
            </form>
            <p className="m-0 text-sm text-text-muted">
              Du må godta <Link href="/vilkar">bruksvilkårene</Link> i neste steg. Markedsføring er
              valgfritt og påvirker ikke varslene dine. Se{' '}
              <a href={privacyPolicyUrl()}>Luma Trainings personvernerklæring</a>.
            </p>
          </Stack>
        </div>
      </section>
    </>
  );
}
