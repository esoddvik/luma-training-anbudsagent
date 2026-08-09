import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, Stack } from '@luma/ui';
import { FunnelBeacon } from '@/components/funnel-beacon';
import { listServiceTemplateChoices } from '@/server/profiles';

export const metadata: Metadata = {
  title: 'Finn anbud i din bransje',
  description:
    'Velg hva virksomheten din leverer og se hvilke offentlige anbud som er kunngjort. Gratis, uten å registrere deg først.',
};

/**
 * The picker: the top of the search-first funnel
 * (IDE Agent Spec v3, section 3.2).
 *
 * Static with hourly revalidation, never `force-dynamic` — the spec makes that
 * a rule for public pages, and this one is meant to be indexed and instant.
 */
export const revalidate = 3600;

export default async function FinnAnbudPage() {
  const templates = await listServiceTemplateChoices();

  return (
    <Stack gap="xl">
      {/* `picker_viewed` is the only funnel event with no template slug:
          nothing has been chosen yet. It is the denominator every later rate is
          measured against. Emitted as a beacon rather than from this function,
          because this page is prerendered and this function runs once an hour,
          not once per reader. */}
      <FunnelBeacon type="picker_viewed" />
      <Stack gap="md" className="prose-measure">
        <h1 className="page-heading">Finn anbud i din bransje</h1>
        <p className="m-0">
          Velg hva virksomheten din leverer, så viser vi kunngjøringene som er publisert på Doffin
          de siste 90 dagene. Du trenger ikke registrere deg for å se dem.
        </p>
      </Stack>

      <ul className="m-0 grid list-none gap-md p-0 md:grid-cols-2">
        {templates.map((template) => (
          <li key={template.slug}>
            <Card heading={template.name} titleLevel={2}>
              <Stack gap="sm">
                <p className="m-0">{template.description}</p>
                <p className="m-0">
                  <Link href={`/anbud-for/${template.slug}`}>Se anbud for {template.name}</Link>
                </p>
              </Stack>
            </Card>
          </li>
        ))}
      </ul>
    </Stack>
  );
}
