import type { Metadata } from 'next';
import { currentLegalDocumentSeed } from '@luma/content';
import { Alert, Stack } from '@luma/ui';
import { COVERAGE_HEADING, COVERAGE_TEXT } from '@/content/copy';
import { privacyPolicyUrl } from '@/lib/legal';
import { parseLegalBody } from '@/server/legal-body';

export const metadata: Metadata = {
  title: 'Bruksvilkår',
  description:
    'Bruksvilkår for Luma Anbudsvarsling, inkludert hva tjenesten dekker og hvilket ansvar du har som bruker.',
};

/**
 * Bruksvilkår (spec section 19).
 *
 * The text is not written here. It comes from `@luma/content`, which is the
 * same source the version in `legal_document_versions` is seeded from and the
 * same text `consent_text_versions` records when somebody accepts. This page
 * used to hold the prose inline and stamp a separate `TERMS_VERSION` constant,
 * which meant a user could accept version X while reading version Y.
 *
 * The coverage notice below is *not* part of the document body. Section 51
 * item 3 requires it on the landing page and in the terms, and it reads from
 * the same constant the landing page does, so the two cannot drift.
 */
export default function VilkarPage() {
  const terms = currentLegalDocumentSeed('terms');

  return (
    <Stack gap="lg">
      <h1 className="page-heading">Bruksvilkår</h1>
      {terms ? <p className="m-0 text-sm text-text-muted">Versjon {terms.version}</p> : null}

      {/* Spec 51, punkt 3: dekningsteksten skal stå både på landingssiden og i
          vilkårene. Begge steder leser samme konstant. */}
      <Alert tone="info" heading={COVERAGE_HEADING} titleLevel={2}>
        <p className="m-0 prose-measure">{COVERAGE_TEXT}</p>
      </Alert>

      {terms ? (
        <Stack gap="md" className="prose-measure">
          {parseLegalBody(terms.body).map((block, index) =>
            block.type === 'heading' ? (
              <h2 key={index} className="section-heading">
                {block.text}
              </h2>
            ) : (
              <p key={index} className="m-0">
                {block.text}
              </p>
            ),
          )}

          <p className="m-0">
            Behandling av personopplysninger er beskrevet i{' '}
            <a href={privacyPolicyUrl()}>Luma Trainings personvernerklæring</a>.
          </p>
        </Stack>
      ) : (
        // Not reachable in a migrated database, and not a crash if it ever is.
        <Alert tone="warning" heading="Vilkårene er ikke tilgjengelige">
          <p className="m-0">
            Vi klarte ikke å hente gjeldende vilkår. Ta kontakt, så sender vi dem.
          </p>
        </Alert>
      )}
    </Stack>
  );
}
