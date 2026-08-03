/**
 * A rendered fragment, in both parts at once.
 *
 * Building HTML and text side by side in the same function is what keeps them
 * honest. The alternative - two template trees - drifts within a week, and the
 * link-parity test would then be catching real bugs instead of preventing
 * them.
 */
export interface Part {
  readonly html: string;
  readonly text: string;
}

/** Markers the ordering tests key on. They are HTML comments, so clients ignore them. */
export const MARKERS = {
  header: 'luma:section:header',
  title: 'luma:section:title',
  count: 'luma:section:count',
  competitions: 'luma:section:competitions',
  tenderCard: (id: string) => `luma:tender-card:${id}`,
  plannedStart: 'luma:section:planned:start',
  plannedEnd: 'luma:section:planned:end',
  plannedCard: (id: string) => `luma:planned-card:${id}`,
  changes: 'luma:section:changes',
  profileAdmin: 'luma:section:profile-admin',
  promotionStart: 'luma:promotion:start',
  promotionEnd: 'luma:promotion:end',
  notificationSettings: 'luma:section:notification-settings',
  legal: 'luma:section:legal',
} as const;

export function comment(marker: string): string {
  return `<!--${marker}-->`;
}

/** Joins fragments, dropping empty ones, with a single newline between them. */
export function joinParts(parts: readonly (Part | null | undefined)[]): Part {
  const present = parts.filter((part): part is Part => Boolean(part));
  return {
    html: present
      .map((part) => part.html)
      .filter((html) => html.length > 0)
      .join('\n'),
    text: present
      .map((part) => part.text)
      .filter((text) => text.length > 0)
      .join('\n\n'),
  };
}
