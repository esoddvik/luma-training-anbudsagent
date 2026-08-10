import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';

export type DisclosureTone = 'plain' | 'card';

export interface DisclosureProps {
  /** Stable, unique on the page. The panel id is derived from it. */
  readonly id: string;
  /** The always-visible heading text inside the trigger. */
  readonly summary: ReactNode;
  readonly open: boolean;
  /** Called with the state the disclosure would move to. */
  readonly onToggle?: (next: boolean) => void;
  /** Set `false` to drop the `+`/`−` glyph. */
  readonly sign?: boolean;
  readonly tone?: DisclosureTone;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Controlled expand/collapse. State lives in the caller, always — the FAQ wants
 * one open at a time, the results list wants many, and the advanced filter panel
 * wants its state to survive a re-render of the list beneath it. A component
 * that owned the state could serve none of them, and owning it here would also
 * force a `'use client'` boundary on every page that renders a static FAQ.
 *
 * `<details>`/`<summary>` was the other option and was rejected: it cannot be
 * driven from outside without fighting the browser's own toggle, and its open
 * state is invisible to the React tree that has to filter on it.
 */
export function Disclosure({
  id,
  summary,
  open,
  onToggle,
  sign = true,
  tone = 'plain',
  className,
  children,
}: DisclosureProps) {
  const panelId = `${id}-panel`;

  return (
    <div className={cx('luma-disclosure', `luma-disclosure--${tone}`, className)}>
      <button
        id={id}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => onToggle?.(!open)}
        className="luma-disclosure__trigger"
      >
        <span className="luma-disclosure__summary">{summary}</span>
        {sign ? (
          <span aria-hidden="true" className="luma-disclosure__sign">
            {open ? '−' : '+'}
          </span>
        ) : null}
      </button>
      {/* `hidden` rather than unmounting: the panel keeps its id so
       * `aria-controls` always points at a real element, and in-page anchors and
       * find-in-page both keep working once it is opened. */}
      <div id={panelId} hidden={!open} className="luma-disclosure__panel">
        {children}
      </div>
    </div>
  );
}
