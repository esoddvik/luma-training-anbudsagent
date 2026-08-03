import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';

export interface PromotionProps {
  /** Spec section 43: recommended labels are "Fra Luma Training" and similar. */
  readonly label?: string;
  readonly heading?: ReactNode;
  readonly children: ReactNode;
  /** Spec section 23.4: paid offers must say so. */
  readonly paid?: boolean;
  readonly className?: string;
}

const DISCLOSURE =
  'Dette er informasjon om kurs eller faglig innhold fra Luma Training. Det påvirker ikke hvilke anbud du får se.';

const PAID_DISCLOSURE = 'Dette er et betalt tilbud.';

/**
 * Luma promotion block.
 *
 * Spec section 23.4 requires promotion to be visually separated from tender
 * content, labelled as Luma content, and marked when the offer is paid. The
 * label and the disclosure are part of the component rather than a caller
 * responsibility, so a promotion block cannot ship without them.
 *
 * Placement is still the caller's job: section 23.3 allows promotion only
 * *after* the tender content.
 */
export function Promotion({
  label = 'Fra Luma Training',
  heading,
  children,
  paid = false,
  className,
}: PromotionProps) {
  return (
    <aside className={cx('luma-promotion', className)} aria-label={label}>
      <span className="luma-promotion__label">{label}</span>
      {heading === undefined ? null : <p className="luma-promotion__title">{heading}</p>}
      {children}
      <p className="luma-promotion__disclosure">
        {paid ? `${PAID_DISCLOSURE} ${DISCLOSURE}` : DISCLOSURE}
      </p>
    </aside>
  );
}
