import type { HTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';

/**
 * `planlagt` marks a planlagt anskaffelse. Spec section 16 requires planned
 * procurements to be a clearly marked category of their own, so the variant is
 * named after the domain term rather than after a colour.
 */
export type BadgeVariant = 'neutral' | 'planlagt' | 'treff' | 'success' | 'warning' | 'danger';

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  readonly variant?: BadgeVariant;
}

export function Badge({ variant = 'neutral', className, children, ...rest }: BadgeProps) {
  return (
    <span {...rest} className={cx('luma-badge', `luma-badge--${variant}`, className)}>
      {children}
    </span>
  );
}
