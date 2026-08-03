import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, Card, Cluster, Stack } from '@luma/ui';
import { SHARE_INVITATION } from '@/content/copy';

/**
 * Spec section 17: delingslenker skal ikke indekseres. The `X-Robots-Tag`
 * header in vercel.json covers the CDN; this covers the document itself, so
 * the rule survives a change of hosting.
 */
export const metadata: Metadata = {
  title: 'Delt anbud',
  description: 'Et anbud som er delt med deg via Luma Anbudsvarsling.',
  robots: {
    index: false,
    follow: false,
    nocache: true,
    googleBot: { index: false, follow: false },
  },
};

interface SharedTenderPageProps {
  readonly params: Promise<{ token: string }>;
}

export default async function SharedTenderPage({ params }: SharedTenderPageProps) {
  // The token is intentionally not rendered. Spec section 17: the shared view
  // must never leak who shared it, the profile name or profile criteria.
  await params;

  return (
    <Stack gap="lg">
      <Cluster gap="xs">
        <Badge variant="treff">Delt anbud</Badge>
      </Cluster>
      <h1 className="page-heading">Delt anbud</h1>

      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Denne visningen viser anbudsdata, kategorimerking, en forenklet matchforklaring,
          kildelenke og frist. Den viser aldri hvem som delte anbudet eller hvilke kriterier
          varslingsprofilen deres har.
        </p>
        <p className="m-0">
          Anbudsdataene hentes inn når delingstjenesten kobles på. Utløpte og opphevede lenker viser
          en nøytral side med invitasjon til tjenesten.
        </p>
      </Stack>

      {/* Spec 17: én rolig invitasjonsblokk nederst, ingen annen promotering. */}
      <Card heading="Få dine egne anbudsvarsler fra Luma Training" titleLevel={2} tone="flat">
        <Stack gap="sm">
          <p className="m-0">{SHARE_INVITATION}</p>
          <p className="m-0">
            <Link href="/?kilde=deling">Opprett din egen varslingsprofil</Link>
          </p>
        </Stack>
      </Card>
    </Stack>
  );
}
