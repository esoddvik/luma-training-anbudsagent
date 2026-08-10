import type { Metadata } from 'next';
import Link from 'next/link';
import { Stack } from '@luma/ui';
import { FunnelBeacon } from '@/components/funnel-beacon';
import { PICKER_HEADING, PICKER_HELPER, PICKER_INTRO } from '@/content/copy';
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

/**
 * The badge on each card: the first letter of each of the first two words.
 *
 * Derived rather than authored, so a template added in admin gets a badge
 * without anyone remembering to pick one. Single-word names get a single
 * letter, which is the correct answer rather than a padded one.
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter((word) => word.length > 0)
    .slice(0, 2)
    .map((word) => word.charAt(0).toLocaleUpperCase('nb-NO'))
    .join('');
}

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
        <h1 className="page-heading">{PICKER_HEADING}</h1>
        <p className="m-0">{PICKER_INTRO}</p>
        <p className="m-0 text-text-muted">{PICKER_HELPER}</p>
      </Stack>

      {/* Four across at desktop, two at tablet, one on a phone. The whole card
          is one `<Link>` rather than a card wrapping a link: there is exactly
          one destination per card, so anything less than the whole surface
          being clickable is a smaller target for no reason. */}
      <ul className="m-0 grid list-none gap-md p-0 sm:grid-cols-2 lg:grid-cols-4">
        {templates.map((template) => (
          <li key={template.slug} className="flex">
            <Link
              href={`/anbud-for/${template.slug}`}
              className="luma-card luma-card--raised luma-card--interactive w-full no-underline"
            >
              {/* The flex column is a child, not the card: `.luma-card` ships
                  unlayered from `@luma/ui` and its `display: block` beats a
                  Tailwind `flex` in `@layer utilities` regardless of
                  specificity. */}
              <span className="flex flex-col gap-xs">
                <span
                  aria-hidden="true"
                  className="inline-flex h-[2.5rem] w-[2.5rem] items-center justify-center rounded-md bg-primary-soft font-semibold text-primary"
                >
                  {initials(template.name)}
                </span>
                <span className="text-lg font-semibold text-text">{template.name}</span>
                <span className="text-sm text-text-muted">
                  {template.onboardingHint ?? template.description}
                </span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </Stack>
  );
}
