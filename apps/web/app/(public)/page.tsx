import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Button, buttonClassName, Card, Field, Input, Stack } from '@luma/ui';
import {
  COVERAGE_HEADING,
  COVERAGE_TEXT,
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
  TRUST_TEXT,
} from '@/content/copy';
import { lumaUrl } from '@/lib/luma-links';
import { privacyPolicyUrl } from '@/lib/legal';

export const metadata: Metadata = {
  title: {
    absolute: 'Luma Anbudsvarsling — få beskjed når relevante anbud publiseres',
  },
  description:
    'Fortell oss hvilke oppdrag virksomheten din ser etter. Luma Anbudsvarsling følger med på nye offentlige anbud på Doffin og sender deg treff som passer kriteriene dine. Gratis, fra Luma Training.',
  alternates: { canonical: '/' },
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

export default function LandingPage() {
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
            <div className="flex flex-wrap gap-sm">
              <Link href="#registrering" className={buttonClassName({ variant: 'primary' })}>
                {SIGNUP_SUBMIT}
              </Link>
              <Link href="/koble-til-ai" className={buttonClassName({ variant: 'secondary' })}>
                Koble til AI-verktøyet ditt
              </Link>
            </div>
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
        {/* Dekningstekst. Spec 51, punkt 3: dette er en lanseringsblokkering og
            skal stå tydelig på landingssiden, ikke gjemt i en bunntekst. */}
        <Alert tone="info" heading={COVERAGE_HEADING} titleLevel={2}>
          <p className="m-0 prose-measure">{COVERAGE_TEXT}</p>
        </Alert>

        <section aria-label={SIGNUP_HEADING} className="prose-measure" id="registrering">
          <Card heading={SIGNUP_HEADING} titleLevel={2} tone="raised">
            <Stack gap="md">
              <p className="m-0">{SIGNUP_INTRO}</p>
              {/* TODO(auth): send til POST /api/registrering når autentisering og
                  samtykkelagring er på plass (spec seksjon 10 og 21). */}
              <form action="#registrering" method="post" noValidate>
                <Stack gap="md">
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
                  <Button type="submit" variant="primary">
                    {SIGNUP_SUBMIT}
                  </Button>
                </Stack>
              </form>
              <p className="m-0 text-sm text-text-muted">
                Du må godta <Link href="/vilkar">bruksvilkårene</Link> i neste steg. Markedsføring
                er valgfritt og påvirker ikke varslene dine. Se{' '}
                <a href={privacyPolicyUrl()}>Luma Trainings personvernerklæring</a>.
              </p>
            </Stack>
          </Card>
        </section>

        <section aria-labelledby="tillit" className="prose-measure">
          <h2 id="tillit" className="section-heading mb-sm">
            Rangeringen er upartisk
          </h2>
          <p className="m-0">{TRUST_TEXT}</p>
        </section>
      </Stack>

      <section aria-labelledby="slik-virker-det" className="bleed luma-soft-band">
        <div className="app-shell py-2xl">
          <h2 id="slik-virker-det" className="section-heading mb-lg">
            Slik virker tjenesten
          </h2>
          <ul className="grid list-none grid-cols-1 gap-md p-0 sm:grid-cols-3">
            <Card as="li" heading="1. Sett opp varslingsprofilen" tone="flat">
              <p className="m-0 text-sm">
                Velg bransjemal, geografi, CPV-koder og terskelverdier. Du kan justere kriteriene
                når som helst.
              </p>
            </Card>
            <Card as="li" heading="2. Få treff på e-post" tone="flat">
              <p className="m-0 text-sm">
                Daglig sammendrag eller umiddelbart varsel — du bestemmer. Hvert treff har en
                forklaring på hvorfor det passer, frist og lenke til kunngjøringen.
              </p>
            </Card>
            <Card as="li" heading="3. Forbered deg tidlig" tone="flat">
              <p className="m-0 text-sm">
                Planlagte anskaffelser vises som egen kategori, tydelig merket, slik at du kan
                begynne tilbudsarbeidet før konkurransen publiseres.
              </p>
            </Card>
          </ul>
        </div>
      </section>

      <Card as="section" heading={MCP_HEADING} titleLevel={2}>
        <Stack gap="md" className="prose-measure">
          <p className="m-0">{MCP_TEXT}</p>
          <p className="m-0">
            <Link href="/koble-til-ai">Se hvordan du kobler til</Link> —{' '}
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
