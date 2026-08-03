import type { Metadata } from 'next';
import { Alert, Stack } from '@luma/ui';
import { COVERAGE_HEADING, COVERAGE_TEXT, TRUST_TEXT } from '@/content/copy';
import { privacyPolicyUrl, TERMS_VERSION } from '@/lib/legal';

export const metadata: Metadata = {
  title: 'Bruksvilkår',
  description:
    'Bruksvilkår for Luma Anbudsvarsling, inkludert hva tjenesten dekker og hvilket ansvar du har som bruker.',
};

export default function VilkarPage() {
  return (
    <Stack gap="lg">
      <h1 className="page-heading">Bruksvilkår</h1>
      <p className="m-0 text-sm text-text-muted">Versjon {TERMS_VERSION}</p>

      {/* Spec 51, punkt 3: dekningsteksten skal stå både på landingssiden og i
          vilkårene. Begge steder leser samme konstant. */}
      <Alert tone="info" heading={COVERAGE_HEADING} titleLevel={2}>
        <p className="m-0 prose-measure">{COVERAGE_TEXT}</p>
      </Alert>

      <Stack gap="md" className="prose-measure">
        <h2 className="section-heading">Om tjenesten</h2>
        <p className="m-0">
          Luma Anbudsvarsling er en gratis tjeneste fra Luma Training som varsler om kunngjøringer
          og planlagte anskaffelser publisert på Doffin. Tjenesten er et hjelpemiddel i
          tilbudsarbeidet, ikke en erstatning for oppdragsgivers egne kanaler.
        </p>

        <h2 className="section-heading">Ditt ansvar</h2>
        <p className="m-0">
          Du er selv ansvarlig for å følge fristene og kravene i den enkelte konkurransen. Luma
          Training svarer ikke for tapte muligheter, forsinkede varsler eller feil i data hentet fra
          Doffin.
        </p>

        <h2 className="section-heading">Rangering og markedsføring</h2>
        <p className="m-0">{TRUST_TEXT}</p>

        <h2 className="section-heading">Personopplysninger</h2>
        <p className="m-0">
          Behandling av personopplysninger er beskrevet i{' '}
          <a href={privacyPolicyUrl()}>Luma Trainings personvernerklæring</a>. Du kan slette kontoen
          din når som helst.
        </p>

        <p className="m-0 text-sm text-text-muted">
          Dette er et utkast. Endelige vilkår godkjennes og versjonslagres før tjenesten åpnes for
          publikum.
        </p>
      </Stack>
    </Stack>
  );
}
