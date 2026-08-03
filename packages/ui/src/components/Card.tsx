import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

export type CardTone = 'default' | 'flat' | 'raised';

export interface CardProps extends HTMLAttributes<HTMLElement> {
  readonly tone?: CardTone;
  /** Renders a heading inside the card. Use `titleLevel` to keep the outline sane. */
  readonly heading?: ReactNode;
  readonly titleLevel?: 2 | 3 | 4;
  /** Element to render. `article` and `section` are the usual choices. */
  readonly as?: 'div' | 'article' | 'section' | 'li';
}

export function Card({
  tone = 'default',
  heading,
  titleLevel = 3,
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
        className,
      )}
    >
      {heading === undefined ? null : <Heading className="luma-card__title">{heading}</Heading>}
      {children}
    </Element>
  );
}
