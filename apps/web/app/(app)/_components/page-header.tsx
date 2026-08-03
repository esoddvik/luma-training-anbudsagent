import type { ReactNode } from 'react';

/**
 * The heading block every page in the signed-in service opens with.
 *
 * It exists so the dashboard reads as one product rather than as a set of
 * separately built screens: the same eyebrow-title-lede rhythm, the same place
 * for the page's primary action, the same measure on the introduction.
 *
 * The eyebrow is the one warm note. It uses `--luma-color-primary` rather than
 * `--luma-color-brand`, because it carries text and the signature orange fails
 * AA at body sizes — see the note at the top of `packages/ui/src/tokens.css`.
 *
 * `actions` is a slot rather than a prop shape, so a page can put a link, a
 * button or a small form there without this component growing a variant for
 * each. It sits beside the title on wide screens and wraps under it on a phone.
 */
export interface PageHeaderProps {
  /** Small label above the title. Use it for the section a sub-page belongs to. */
  readonly eyebrow?: ReactNode;
  readonly title: ReactNode;
  /** One short paragraph explaining what the page is for. */
  readonly lede?: ReactNode;
  readonly actions?: ReactNode;
  /** Badges or other status markers, rendered above the eyebrow. */
  readonly status?: ReactNode;
}

export function PageHeader({ eyebrow, title, lede, actions, status }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-sm">
      {status === undefined ? null : status}
      <div className="flex flex-wrap items-start justify-between gap-md">
        <div className="flex flex-col gap-2xs">
          {eyebrow === undefined ? null : (
            <p className="m-0 text-xs font-semibold uppercase tracking-wide text-primary">
              {eyebrow}
            </p>
          )}
          <h1 className="page-heading">{title}</h1>
        </div>
        {actions === undefined ? null : (
          <div className="flex flex-wrap items-center gap-xs">{actions}</div>
        )}
      </div>
      {lede === undefined ? null : (
        <div className="prose-measure flex flex-col gap-xs text-text-muted">{lede}</div>
      )}
    </header>
  );
}
