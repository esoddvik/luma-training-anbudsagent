import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge, buttonClassName, Card, Cluster, Stack } from '@luma/ui';
import { INDUSTRY_TEMPLATE_SEEDS } from '@luma/content';
import { ActionMessage } from '@/components/action-message';
import { ProfileForm } from '@/components/profile-form';
import { createProfileAction } from '@/server/actions/profile-actions';
import { getWebDb } from '@/server/db';
import { listIndustryTemplates, type IndustryTemplateOption } from '@/server/profiles';
import { requireUser } from '@/server/session';
import { PageHeader } from '../../_components/page-header';

export const metadata: Metadata = {
  title: 'Ny varslingsprofil',
  description:
    'Velg en bransjemal eller start blankt, og sett opp hvilke oppdrag du vil få varsel om.',
};

/**
 * Onboarding: creating the first alert profile (spec sections 9.1 and 11.2).
 *
 * Section 9.1 sets an acceptance criterion — the whole journey under five
 * minutes — and section 11.2 names the industry template as the way to reach
 * it. So the templates come first on the page, and picking one is a link that
 * reloads the same form with the fields already filled in. That keeps the flow
 * to one form submission and works without JavaScript.
 *
 * The template's id is recorded on the profile for analytics only. Section 11.2
 * is explicit that it must not influence matching beyond the values it filled
 * in, and nothing in the matcher reads it.
 */

export const dynamic = 'force-dynamic';

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  await requireUser();

  const templates = await listIndustryTemplates(getWebDb());
  const options = templates.length > 0 ? templates : seedFallback();

  const selectedSlug = typeof params['mal'] === 'string' ? params['mal'] : undefined;
  const selected = options.find((template) => template.slug === selectedSlug);

  return (
    <Stack gap="lg">
      <PageHeader
        eyebrow="Varslingsprofiler"
        title="Ny varslingsprofil"
        lede={
          <p className="m-0">
            Velg bransjemalen som ligner mest på virksomheten din, så fyller vi ut CPV-koder og
            søkeord for deg. Du kan endre alt etterpå. Vil du heller starte blankt, hopper du rett
            ned til skjemaet.
          </p>
        }
      />

      <ActionMessage code={params['melding']} />

      <section aria-labelledby="maler-overskrift">
        <Stack gap="md">
          <h2 id="maler-overskrift" className="section-heading">
            Bransjemaler
          </h2>
          {/* A grid rather than a column: these are options to compare, and six
              full-width bands make the reader scroll past the choice instead of
              seeing it. One column on a phone, two from the small breakpoint. */}
          <ul className="m-0 grid list-none grid-cols-1 gap-md p-0 sm:grid-cols-2">
            {options.map((template) => {
              const active = template.slug === selectedSlug;
              return (
                <Card
                  as="li"
                  key={template.slug}
                  tone={active ? 'raised' : 'secondary'}
                  interactive
                  className="relative"
                >
                  <Stack gap="xs" className="h-full">
                    <Cluster gap="xs">
                      <h3 className="m-0 text-base font-semibold">{template.name}</h3>
                      {active ? <Badge variant="success">Valgt</Badge> : null}
                    </Cluster>
                    <p className="m-0 text-sm text-text-muted">{template.description}</p>
                    <p className="m-0 text-sm">
                      {template.cpvInclude.length} CPV-koder og {template.keywordsInclude.length}{' '}
                      søkeord fylles ut.
                    </p>
                    <p className="m-0 mt-auto pt-xs">
                      {/* The `::after` overlay makes the whole card the click
                          target, which is what `interactive` promises: the card
                          lifts under the pointer, so clicking the card body has
                          to do something. The button keeps the accessible name
                          and the focus ring, so keyboard and screen-reader users
                          get one control per template rather than a card-sized
                          link that reads out the whole card. */}
                      <Link
                        href={`/varsler/ny?mal=${template.slug}`}
                        className={buttonClassName({
                          variant: active ? 'ghost' : 'secondary',
                          size: 'sm',
                          className: "after:absolute after:inset-0 after:content-['']",
                        })}
                      >
                        {active ? 'Bruk denne malen på nytt' : `Bruk «${template.name}»`}
                      </Link>
                    </p>
                  </Stack>
                </Card>
              );
            })}
          </ul>
          {selectedSlug !== undefined && selected === undefined ? (
            <p className="m-0 text-sm text-text-muted">
              Fant ikke bransjemalen du ba om. Skjemaet under er tomt, og du kan fylle det ut selv.
            </p>
          ) : null}
          <p className="m-0 text-sm text-text-muted">
            Bransjemalene er redaksjonelt innhold fra Luma Training. De påvirker ingenting utover
            verdiene de fyller inn i profilen din.
          </p>
        </Stack>
      </section>

      <section aria-labelledby="skjema-overskrift">
        <Stack gap="md">
          <h2 id="skjema-overskrift" className="section-heading">
            Kriteriene dine
          </h2>
          <p className="prose-measure m-0 text-sm text-text-muted">
            Profilen opprettes på pause. Du får se en forhåndsvisning av treffene før du aktiverer
            varslingen, slik at ingen sender deg noe du ikke har sett på.
          </p>
          <ProfileForm
            action={createProfileAction}
            submitLabel="Opprett profilen og se forhåndsvisning"
            {...(selected
              ? {
                  prefill: {
                    name: selected.name,
                    cpvInclude: selected.cpvInclude,
                    keywordsInclude: selected.keywordsInclude,
                    ...('id' in selected && isUuid(selected.id)
                      ? { industryTemplateId: selected.id }
                      : {}),
                  },
                }
              : {})}
          />
        </Stack>
      </section>
    </Stack>
  );
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

/**
 * The seed content, shown when nothing has been seeded into the database yet.
 *
 * The ids are the slugs rather than uuids, so `industryTemplateId` is left off
 * the created profile: a foreign key to a template row that does not exist
 * would fail the insert, and recording an id we made up would be worse than
 * recording nothing.
 */
function seedFallback(): IndustryTemplateOption[] {
  return INDUSTRY_TEMPLATE_SEEDS.map((seed) => ({
    id: seed.slug,
    slug: seed.slug,
    name: seed.name,
    description: seed.description,
    cpvInclude: seed.cpvInclude,
    keywordsInclude: seed.keywordsInclude,
  }));
}
