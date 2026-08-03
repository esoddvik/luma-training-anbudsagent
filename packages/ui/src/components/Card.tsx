import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * `secondary` is the grouping surface Luma Training uses for supporting
 * information — the `bg-secondary` panels behind the "hvem passer kurset for"
 * list and the sidebars. It is deliberately *not* the promotion cream: spec
 * 23.4 needs `--luma-color-promotion-surface` to stay unique to `Promotion`,
 * so this tone uses the sunken neutral instead.
 */
export type CardTone = 'default' | 'flat' | 'raised' | 'secondary';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly tone?: CardTone;
  /** Renders a heading inside the card. Use `titleLevel` to keep the outline sane. */
  readonly heading?: ReactNode;
  readonly titleLevel?: 2 | 3 | 4;
  /** Element to render. `article` and `section` are the usual choices. */
  readonly as?: 'div' | 'article' | 'section' | 'li';
  /**
   * Set this only when the whole card is the click target — a selectable
   * option, or a card wrapping a single link. It adds the hover elevation Luma
   * uses on clickable cards.
   *
   * It is separate from `tone` on purpose: a tone describes where the card sits
   * in the hierarchy, not whether it does anything, and a static card that
   * reacts to hover promises an interaction it cannot deliver. This does not
   * make the card focusable or clickable by itself — the real control still has
   * to be a link or a button.
   */
  readonly interactive?: boolean;
}

export function Card({
  tone = 'default',
  heading,
  titleLevel = 3,
  interactive = false,
  as: Element = 'div',
  className,
  children,
  ...rest
}: CardProps) {
  const Heading = `h${titleLevel}` as const;

  return (
    <Element
      {...rest}
      className={cx(
        'luma-card',
        tone === 'flat' && 'luma-card--flat',
        tone === 'raised' && 'luma-card--raised',
        tone === 'secondary' && 'luma-card--secondary',
        interactive && 'luma-card--interactive',
        className,
      )}
    >
      {heading === undefined ? null : <Heading className="luma-card__title">{heading}</Heading>}
      {children}
    </Element>
  );
}
