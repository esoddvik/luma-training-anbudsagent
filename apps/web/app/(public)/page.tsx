import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert, Button, Card, Field, Input, Stack } from '@luma/ui';
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

export default function LandingPage() {
  return (
    <Stack gap="2xl">
      <section className="prose-measure">
        <p className="m-0 text-sm font-semibold uppercase tracking-wide text-text-muted">
          {SERVICE_TAGLINE}
        </p>
        <h1 className="mt-xs mb-lg text-3xl font-semibold">{LANDING_HEADING}</h1>
        {LANDING_INTRO.map((paragraph) => (
          <p key={paragraph} className="mb-md text-lg">
            {paragraph}
          </p>
        ))}
      </section>

      {/* Dekningstekst. Spec 51, punkt 3: dette er en lanseringsblokkering og
          skal stå tydelig på landingssiden, ikke gjemt i en bunntekst. */}
      <Alert tone="info" heading={COVERAGE_HEADING} titleLevel={2}>
        <p className="m-0 prose-measure">{COVERAGE_TEXT}</p>
      </Alert>

      <section aria-label={SIGNUP_HEADING} className="prose-measure" id="registrering">
        <Card heading={SIGNUP_HEADING} titleLevel={2} tone="default">
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
              Du må godta <Link href="/vilkar">bruksvilkårene</Link> i neste steg. Markedsføring er
              valgfritt og påvirker ikke varslene dine. Se{' '}
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

      <section aria-labelledby="slik-virker-det">
        <h2 id="slik-virker-det" className="section-heading mb-md">
          Slik virker tjenesten
        </h2>
        <ul className="grid list-none grid-cols-1 gap-md p-0 sm:grid-cols-3">
          <Card as="li" heading="1. Sett opp varslingsprofilen">
            <p className="m-0 text-sm">
              Velg bransjemal, geografi, CPV-koder og terskelverdier. Du kan justere kriteriene når
              som helst.
            </p>
          </Card>
          <Card as="li" heading="2. Få treff på e-post">
            <p className="m-0 text-sm">
              Daglig sammendrag eller umiddelbart varsel — du bestemmer. Hvert treff har en
              forklaring på hvorfor det passer, frist og lenke til kunngjøringen.
            </p>
          </Card>
          <Card as="li" heading="3. Forbered deg tidlig">
            <p className="m-0 text-sm">
              Planlagte anskaffelser vises som egen kategori, tydelig merket, slik at du kan begynne
              tilbudsarbeidet før konkurransen publiseres.
            </p>
          </Card>
        </ul>
      </section>

      <section aria-labelledby="mcp" className="prose-measure">
        <h2 id="mcp" className="section-heading mb-sm">
          {MCP_HEADING}
        </h2>
        <p className="mb-md">{MCP_TEXT}</p>
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
      </section>
    </Stack>
  );
}
