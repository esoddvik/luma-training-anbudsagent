import type { Metadata } from 'next';
import Link from 'next/link';
import { Button, buttonClassName, Card, Checkbox, Cluster, Stack } from '@luma/ui';
import { MARKETING_CONSENT_TEXT_NB, PROMOTION_SETTING_TEXT_NB } from '@luma/domain';
import { ActionMessage } from '@/components/action-message';
import {
  setMarketingConsentAction,
  updateNotificationPreferencesAction,
} from '@/server/actions/settings-actions';
import { getWebDb } from '@/server/db';
import { formatDateTime, isoDate } from '@/server/format';
import { requireUser } from '@/server/session';
import { getAccountSettings } from '@/server/settings';
import { privacyPolicyUrl } from '@/lib/legal';
import { PageHeader } from '../_components/page-header';

export const metadata: Metadata = {
  title: 'Innstillinger',
  description:
    'Varslingspreferanser, promotering fra Luma Training, markedsføringssamtykke, dataeksport og sletting av konto.',
};

/**
 * Account settings (spec sections 20 to 22, and section 40).
 *
 * The two switches on this page look alike and are not alike, so they are in
 * separate forms with separate explanations:
 *
 * - **Promotion in tender emails** is a content setting for the service. The
 *   wording is spec section 22's, reproduced exactly, and turning it off must
 *   never stop the tender alerts.
 * - **Marketing consent** is consent under GDPR. The wording is spec section
 *   20.2's, reproduced exactly, unticked by default, with the privacy policy
 *   linked right beside it, and every change stored as a new append-only event
 *   with its text version.
 *
 * Section 21 requires that withdrawing one does not affect the other, which is
 * why they cannot share a submit button.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser();
  const settings = await getAccountSettings(getWebDb(), user.id);

  return (
    <Stack gap="lg">
      <PageHeader title="Innstillinger" lede={<p className="m-0">Innlogget som {user.email}</p>} />

      <ActionMessage code={params['melding']} />

      <Card as="section" heading="Varslingspreferanser" titleLevel={2}>
        <form action={updateNotificationPreferencesAction}>
          <Stack gap="md">
            <Checkbox
              name="tenderAlertsEnabled"
              defaultChecked={settings.preferences.tenderAlertsEnabled}
              label="Send meg anbudsvarsler på e-post"
            />
            <Checkbox
              name="digestEnabled"
              defaultChecked={settings.preferences.digestEnabled}
              label="Send meg sammendrag med nye treff"
            />
            <Checkbox
              name="immediateAlertsEnabled"
              defaultChecked={settings.preferences.immediateAlertsEnabled}
              label="Send meg umiddelbart varsel når et treff har høy relevans"
            />

            <hr className="m-0 border-0 border-t border-line" />

            {/* Spec 22: teksten er gjengitt ordrett. Dette er en
                innholdsinnstilling for tjenesten, ikke markedsføringssamtykke. */}
            <Stack gap="sm">
              <p className="prose-measure m-0">{PROMOTION_SETTING_TEXT_NB}</p>
              <Checkbox
                name="includeLumaPromotionsInTenderEmails"
                defaultChecked={settings.preferences.includeLumaPromotionsInTenderEmails}
                label="Vis faglig innhold fra Luma Training i anbudsvarslene og i tjenesten"
              />
              <p className="m-0 text-sm text-text-muted">
                Slår du dette av, får du nøyaktig de samme anbudene som før. Promotering påvirker
                aldri hvilke treff du får eller hvordan de rangeres.
              </p>
            </Stack>

            <Cluster gap="xs">
              <Button type="submit" variant="primary">
                Lagre varslingspreferansene
              </Button>
            </Cluster>
          </Stack>
        </form>
      </Card>

      {/* Spec 20.2: teksten er gjengitt ordrett, uavkrysset som standard, med
          lenke til personvernerklæringen rett ved teksten. */}
      <Card as="section" heading="Markedsføringssamtykke" titleLevel={2}>
        <form action={setMarketingConsentAction}>
          <Stack gap="md">
            <p className="prose-measure m-0">{MARKETING_CONSENT_TEXT_NB}</p>
            <p className="m-0 text-sm">
              <a href={privacyPolicyUrl()} rel="noreferrer noopener" target="_blank">
                Les personvernerklæringen til Luma Training
              </a>
            </p>

            <p className="prose-measure m-0 text-sm text-text-muted">
              Samtykket er frivillig og ikke nødvendig for å bruke Luma Anbudsvarsling. Trekker du
              det tilbake, fortsetter anbudsvarslene som før.
            </p>

            {settings.preferences.marketingEmailConsent ? (
              <Stack gap="sm">
                <p className="m-0">
                  <strong>Du har gitt markedsføringssamtykke.</strong>
                  {settings.marketingConsentChangedAt ? (
                    <>
                      {' '}
                      Registrert{' '}
                      <time dateTime={isoDate(settings.marketingConsentChangedAt)}>
                        {formatDateTime(settings.marketingConsentChangedAt)}
                      </time>
                      {settings.marketingConsentTextVersion
                        ? ` (tekstversjon ${settings.marketingConsentTextVersion})`
                        : null}
                      .
                    </>
                  ) : null}
                </p>
                <input type="hidden" name="samtykke" value="nei" />
                <Cluster gap="xs">
                  <Button type="submit" variant="secondary">
                    Trekk tilbake samtykket
                  </Button>
                </Cluster>
              </Stack>
            ) : (
              <Stack gap="sm">
                <p className="m-0">Du har ikke gitt markedsføringssamtykke.</p>
                <input type="hidden" name="samtykke" value="ja" />
                <Cluster gap="xs">
                  <Button type="submit" variant="secondary">
                    Ja, jeg samtykker
                  </Button>
                </Cluster>
              </Stack>
            )}
          </Stack>
        </form>
      </Card>

      <Card as="section" heading="Dine data" titleLevel={2} tone="secondary">
        <Stack gap="md">
          <Stack gap="sm">
            <h3 className="m-0 text-base font-semibold">Last ned dataene dine</h3>
            <p className="prose-measure m-0">
              Du kan når som helst laste ned en maskinlesbar kopi av det vi har lagret om deg:
              kontoopplysninger, varslingsprofiler, lagrede anbud, tilbakemeldinger, delingslenker
              og samtykkehistorikk.
            </p>
            <p className="m-0">
              <a
                href="/innstillinger/eksport"
                download
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              >
                Last ned dataene dine som JSON
              </a>
            </p>
          </Stack>

          <hr className="m-0 border-0 border-t border-line" />

          <Stack gap="sm">
            <h3 className="m-0 text-base font-semibold">Slett kontoen</h3>
            <p className="prose-measure m-0">
              Sletting fjerner kontoen, varslingsprofilene, lagrede anbud, tilbakemeldinger og
              delingslenkene dine. Aktive delingslenker slutter å virke. Handlingen kan ikke angres.
            </p>
            <p className="m-0">
              <Link
                href="/innstillinger/slett-konto"
                className={buttonClassName({ variant: 'secondary', size: 'sm' })}
              >
                Gå til sletting av konto
              </Link>
            </p>
          </Stack>
        </Stack>
      </Card>

      <Card as="section" heading="Personvern og vilkår" titleLevel={2} tone="secondary">
        <Cluster gap="md">
          <Link href="/personvern">Personvern i denne tjenesten</Link>
          <Link href="/vilkar">Bruksvilkår</Link>
          <a href={privacyPolicyUrl()} rel="noreferrer noopener" target="_blank">
            Luma Trainings personvernerklæring
          </a>
        </Cluster>
      </Card>
    </Stack>
  );
}
