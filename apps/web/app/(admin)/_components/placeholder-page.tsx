import type { ReactNode } from 'react';
import { Card, Stack } from '@luma/ui';
import { PageHeader } from '../../(app)/_components/page-header';

/**
 * The shape every administration page that is not wired up yet takes.
 *
 * These pages are honest placeholders: they say what the surface will show and
 * what it is waiting on. Giving them one shared shape is the point — an admin
 * moving between Innhenting, Matching and E-post should not have to re-read the
 * layout each time, and the note about what is still missing should be in the
 * same place on all of them rather than trailing the description as a second
 * paragraph that looks like more description.
 *
 * The note sits on the supporting-information surface (`Card tone="secondary"`),
 * which is the tint Luma Training uses to group material that stands beside the
 * main content rather than being it.
 */
export interface PlaceholderPageProps {
  readonly title: ReactNode;
  /** What this surface is for. One paragraph. */
  readonly lede: ReactNode;
  /** What it is still waiting on, or the rule that governs it. */
  readonly note: ReactNode;
}

export function PlaceholderPage({ title, lede, note }: PlaceholderPageProps) {
  return (
    <Stack gap="lg">
      <PageHeader eyebrow="Administrasjon" title={title} lede={<p className="m-0">{lede}</p>} />
      <Card as="section" tone="secondary" className="prose-measure">
        <p className="m-0">{note}</p>
      </Card>
    </Stack>
  );
}
