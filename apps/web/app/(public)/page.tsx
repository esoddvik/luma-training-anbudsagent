import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, Card, Field, Input, Stack } from '@luma/ui';
import {
  LANDING_HEADING,
  LANDING_INTRO,
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
import { requestSignupAction } from '@/server/actions/registration-actions';
import { listServiceTemplateChoices } from '@/server/profiles';
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
 * What the panel beside the headline says.
 *
 * Every line is a fact the service can be held to, not a benefit: the price,
 * the source, the two delivery modes, what it takes to sign up. That is the
 * section 42 register — praktisk og ærlig, null hype — and it is also the only
 * honest thing to put here, since the marketing site fills this half of the
 * hero with a product photograph and this service has no product to photograph.
 */
const HERO_FACTS = [
  { term: 'Pris', description: 'Gratis' },
  { term: 'Kilde', description: 'Kunngjøringer publisert på Doffin' },
  { term: 'Varsling', description: 'Daglig sammendrag eller straks — du velger' },
  { term: 'Planlagte anskaffelser', description: 'Egen kategori, tydelig merket' },
  { term: 'Du trenger', description: 'En e-postadresse' },
] as const;

/**
 * Rebuilt hourly rather than pinned at deploy, so a template added in admin
 * appears without a deploy (spec section 11.2). Static, never `force-dynamic`:
 * IDE Agent Spec v3 section 3.2 makes that a rule for public pages.
 */
export const revalidate = 3600;

export default async function LandingPage() {
  // Database first, editorial seeds as the fallback — see
  // `listServiceTemplateChoices` for why the fallback is on configuration
  // rather than on error. The action re-resolves the posted slug against the
  // live table, so a forged option value cannot write arbitrary criteria into
  // a profile.
  const templates = await listServiceTemplateChoices();

  return (
    <>
      <section className="bleed luma-hero">
        <div className="app-shell grid items-center gap-xl py-2xl md:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] md:py-3xl">
          <div className="flex flex-col gap-lg">
            <p className="eyebrow">{SERVICE_TAGLINE}</p>
            <h1 className="hero-heading">
              <HeroHeading />
            </h1>
            <p className="prose-measure m-0 text-lg text-text-muted">{LANDING_INTRO[0]}</p>
            <p className="prose-measure m-0 text-lg text-text-muted">{LANDING_INTRO[1]}</p>
            {/*
             * No button here.
             *
             * The hero used to carry a «Opprett varslingsprofil» link that
             * jumped to `#registrering`, one screen down. The signup form now
             * sits directly below the hero with the same label on its own
             * submit button, so the link was sending people past nothing to
             * reach a button they could already see — and it made the page
             * read as though it had two calls to action when it has one.
             *
             * The header's «Kom i gang» still points at `#registrering`, which
             * is what that anchor is for on pages further down the site.
             */}
          </div>

          <Card heading="Kort fortalt" titleLevel={2} tone="raised">
            <dl className="m-0 flex flex-col gap-sm">
              {HERO_FACTS.map((fact) => (
                <div key={fact.term}>
                  <dt className="m-0 text-xs uppercase tracking-wide text-text-muted">
                    {fact.term}
                  </dt>
                  <dd className="m-0">{fact.description}</dd>
                </div>
              ))}
            </dl>
          </Card>
        </div>
      </section>

      <Stack gap="2xl">
        {/*
         * Signup, sitting directly on the page.
         *
         * It used to be a `Card`, which drew a box around the one thing on the
         * page nobody needs persuading to look at, indented its contents away
         * from the left edge every other block on the page starts at, and gave
         * the form a second border inside the card's own. A section heading, a
         * line of intro and the form itself line up with the hero above them
         * and the trust text below, so the eye runs straight down one edge.
         *
         * `prose-measure` caps the column so the input does not stretch the
         * full shell width — a 72rem-wide e-mail field looks like a mistake.
         */}
        <section aria-labelledby="registrering-tittel" className="prose-measure" id="registrering">
          <Stack gap="md">
            <h2 id="registrering-tittel" className="section-heading">
              {SIGNUP_HEADING}
            </h2>
            <p className="m-0">{SIGNUP_INTRO}</p>
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
        </section>

        <section aria-labelledby="tillit" className="prose-measure">
          <h2 id="tillit" className="section-heading mb-sm">
            Rangeringen er upartisk
          </h2>
          <p className="m-0">{TRUST_TEXT}</p>
        </section>
      </Stack>

      <Card as="section" heading={MCP_HEADING} titleLevel={2}>
        <Stack gap="md" className="prose-measure">
          <p className="m-0">{MCP_TEXT}</p>
          {/*
           * States the order plainly. The connection needs a token, the token
           * needs an account, so this is something registering unlocks — not a
           * second way in. Saying so here is cheaper than letting someone
           * follow the link and work it out from a page that cannot help them.
           */}
          <p className="m-0">
            Du oppretter tilgangstokenet inne i tjenesten, så dette gjør du etter at du har
            registrert varslingsprofilen din.
          </p>
          <p className="m-0">
            <Link href="/ai-verktoy">Les hva du kan gjøre med koblingen</Link> —{' '}
            <a
              href={lumaUrl('/kurs/vinn-flere-anbud-med-ai', {
                medium: 'landingsside',
                campaign: 'vinn-flere-anbud-med-ai',
                content: 'mcp-seksjon',
              })}
            >
              les om kurset «Vinn flere anbud med AI»
            </a>
          </p>
        </Stack>
      </Card>
    </>
  );
}
