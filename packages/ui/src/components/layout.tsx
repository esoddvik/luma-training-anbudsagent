import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

export type StackGap = 'xs' | 'sm' | 'md' | 'lg' | 'xl' | '2xl';
export type ClusterGap = 'xs' | 'sm' | 'md' | 'lg';

export interface StackProps extends HTMLAttributes<HTMLElement> {
  readonly gap?: StackGap;
  readonly as?: 'div' | 'section' | 'article' | 'ul' | 'ol' | 'li' | 'form' | 'nav';
}

/** Vertical rhythm helper: one flow direction, one gap. */
export function Stack({
  gap = 'md',
  as: Element = 'div',
  className,
  children,
  ...rest
}: StackProps) {
  return (
    <Element {...rest} data-gap={gap} className={cx('luma-stack', className)}>
      {children}
    </Element>
  );
}

export interface ClusterProps extends HTMLAttributes<HTMLElement> {
  readonly gap?: ClusterGap;
  readonly justify?: 'start' | 'between' | 'end';
  readonly align?: 'center' | 'start';
  readonly as?: 'div' | 'ul' | 'ol' | 'li' | 'nav' | 'p' | 'span';
}

/** Horizontal group that wraps instead of overflowing on narrow screens. */
export function Cluster({
  gap = 'sm',
  justify = 'start',
  align = 'center',
  as: Element = 'div',
  className,
  children,
  ...rest
}: ClusterProps) {
  return (
    <Element
      {...rest}
      data-gap={gap}
      data-justify={justify}
      data-align={align}
      className={cx('luma-cluster', className)}
    >
      {children}
    </Element>
  );
}

export interface VisuallyHiddenProps {
  readonly children: ReactNode;
  readonly as?: 'span' | 'div' | 'p';
}

/** Text for screen readers only. Never use it to hide something interactive. */
export function VisuallyHidden({ children, as: Element = 'span' }: VisuallyHiddenProps) {
  return <Element className="luma-visually-hidden">{children}</Element>;
}

export interface SkipLinkProps {
  /** Fragment id of the main landmark, without the `#`. */
  readonly targetId?: string;
  readonly children?: ReactNode;
}

/** First focusable element on the page. Hidden until focused. */
export function SkipLink({
  targetId = 'hovedinnhold',
  children = 'Hopp til hovedinnhold',
}: SkipLinkProps) {
  return (
    <a className="luma-skip-link" href={`#${targetId}`}>
      {children}
    </a>
  );
}
