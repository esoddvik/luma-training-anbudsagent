import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';

export interface PromotionProps {
  /** Spec section 43: recommended labels are "Fra Luma Training" and similar. */
  readonly label?: string;
  readonly heading?: ReactNode;
  readonly children: ReactNode;
  /** Spec section 23.4: paid offers must say so. */
  readonly paid?: boolean;
  /**
   * The call to action, given its own row under the body.
   *
   * A slot rather than something the caller drops into `children`, because
   * where it went by default was the end of the last paragraph — an anchor
   * inline in prose, which is what you write when nobody decided where the
   * action belongs.
   */
  readonly action?: ReactNode;
  /**
   * A second column of facts about the offer. Its presence is what switches
   * the block to the two-column composition; without it nothing changes.
   *
   * The point is that the block should be able to say something concrete.
   * A promotion that only asserts is indistinguishable from every other
   * promotion, and this product's argument for its own promotion is that it
   * is specific and checkable.
   */
  readonly rail?: ReactNode;
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
  action,
  rail,
  className,
}: PromotionProps) {
  const disclosure = (
    <p className="luma-promotion__disclosure">
      {paid ? `${PAID_DISCLOSURE} ${DISCLOSURE}` : DISCLOSURE}
    </p>
  );

  // The plain block, unchanged: three of the four callers are a heading and a
  // paragraph in a margin, and widening those into a composition they have no
  // second column for would only add air.
  if (rail === undefined) {
    return (
      <aside className={cx('luma-promotion', className)} aria-label={label}>
        <span className="luma-promotion__label">{label}</span>
        {heading === undefined ? null : <p className="luma-promotion__title">{heading}</p>}
        {children}
        {action === undefined ? null : <div className="luma-promotion__action">{action}</div>}
        {disclosure}
      </aside>
    );
  }

  /*
   * The two-column form. The disclosure spans both columns rather than sitting
   * under one of them: section 23.4 wants it read as covering the whole block,
   * and a fine-print line tucked into the left column reads as a footnote to
   * the paragraph above it.
   */
  return (
    <aside className={cx('luma-promotion luma-promotion--feature', className)} aria-label={label}>
      <div>
        <span className="luma-promotion__label">{label}</span>
        {heading === undefined ? null : <p className="luma-promotion__title">{heading}</p>}
        {children}
        {action === undefined ? null : <div className="luma-promotion__action">{action}</div>}
      </div>
      <div className="luma-promotion__rail">{rail}</div>
      {disclosure}
    </aside>
  );
}
