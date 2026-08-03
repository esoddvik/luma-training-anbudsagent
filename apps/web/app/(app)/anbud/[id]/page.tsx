import type { Metadata } from 'next';
import { Badge, Button, Card, Cluster, Promotion, Stack } from '@luma/ui';
import { lumaUrl } from '@/lib/luma-links';

export const metadata: Metadata = {
  title: 'Anbud',
  description: 'Detaljer om et anbud, med matchforklaring, frist og kildelenke.',
};

interface TenderPageProps {
  readonly params: Promise<{ id: string }>;
}

export default async function TenderPage({ params }: TenderPageProps) {
  const { id } = await params;

  return (
    <Stack gap="lg">
      <Cluster gap="xs">
        <Badge variant="treff">Treff</Badge>
        <Badge variant="neutral">Kunngjort</Badge>
      </Cluster>
      <h1 className="page-heading">Anbud</h1>
      <p className="m-0 text-sm text-text-muted">Referanse: {id}</p>

      <Stack gap="md" className="prose-measure">
        <p className="m-0">
          Siden viser oppdragsgiver, frist, kategori, tildelingskriterier, kvalifikasjonskrav, en
          forklaring på hvorfor anbudet passer varslingsprofilen din, kildelenke til Doffin og
          tidspunktet for siste synkronisering.
        </p>
        <p className="m-0">Anbudsdataene kobles på når normaliseringen er ferdig.</p>
      </Stack>

      <Card heading="Del internt" titleLevel={2} tone="flat">
        <Stack gap="sm">
          <p className="m-0">
            Lag en delingslenke som en kollega kan åpne uten å logge inn. Lenken viser ingen
            persondata og kan oppheves når som helst.
          </p>
          <Cluster gap="xs">
            {/* TODO(auth): kobles til POST /api/delinger når autentisering er på plass. */}
            <Button variant="secondary" disabled>
              Lag delingslenke
            </Button>
            <Button variant="ghost" disabled>
              Lagre anbudet
            </Button>
          </Cluster>
        </Stack>
      </Card>

      {/* Spec 23.3: promotering kan stå på anbudsdetaljsiden, men først etter
          anbudsinnholdet. Spec 23.4: tydelig adskilt og merket. */}
      <Promotion heading="Vil du bli bedre i tilbudsarbeidet?">
        <p className="m-0">
          Kurset «Vinn flere anbud med AI» går gjennom hvordan du leser konkurransegrunnlaget
          raskere og bygger en tilbudsprosess du kan gjenta.
        </p>
        <p className="m-0 mt-xs">
          <a
            href={lumaUrl('/kurs/vinn-flere-anbud-med-ai', {
              medium: 'nettsted',
              campaign: 'vinn-flere-anbud-med-ai',
              content: 'anbudsdetalj',
            })}
          >
            Les mer om kurset
          </a>
        </p>
      </Promotion>
    </Stack>
  );
}
