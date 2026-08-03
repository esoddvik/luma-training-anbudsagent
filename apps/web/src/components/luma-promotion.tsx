import { Promotion } from '@luma/ui';
import { lumaUrl } from '@/lib/luma-links';

/**
 * A Luma promotion block, subject to the section 23 rules.
 *
 * The rules the *caller* still owns are placement (section 23.3: only after the
 * tender content, only on the allowed surfaces) and whether the user has turned
 * promotion off (section 22). `allowed` makes the second one an explicit
 * argument rather than something a page can forget: passing `false` renders
 * nothing at all.
 *
 * Labelling, the disclosure and the paid marker come from `Promotion` in
 * `@luma/ui`, so a promotion block cannot ship without them.
 */

export interface LumaPromotionProps {
  /** From `promotionAllowed()`. False renders nothing. */
  readonly allowed: boolean;
  /** `utm_content`: which surface the link was clicked from. */
  readonly placement: string;
}

/**
 * Ladder level 1 — free professional content — is the default for a surface
 * with no editorial selection behind it (spec section 23.1). The database's
 * `editorial_recommendations` table drives the digest; the web surfaces show
 * this steady, low-threshold block rather than inventing a rotation of their
 * own, because ranking and promotion must stay separate (ADR-6).
 */
export function LumaPromotion({ allowed, placement }: LumaPromotionProps) {
  if (!allowed) return null;

  return (
    <Promotion heading="Vil du bli bedre i tilbudsarbeidet?">
      <p className="m-0">
        Luma Training har gratis fagartikler og guider om anbudsarbeid: hvordan du leser
        konkurransegrunnlaget raskere, og hvordan du bygger en tilbudsprosess du kan gjenta.
      </p>
      <p className="m-0 mt-xs">
        <a
          href={lumaUrl('/fagstoff', {
            medium: 'nettsted',
            campaign: 'fagstoff',
            content: placement,
          })}
        >
          Les fagstoffet fra Luma Training
        </a>
      </p>
    </Promotion>
  );
}

/**
 * The promotion shown in an empty state (spec section 23.3 allows it there).
 *
 * Kept separate because an empty state has no tender content to come after, so
 * the "promotion last" rule is satisfied differently: the block sits below the
 * explanation of what the user should do next, never above it.
 */
export function EmptyStatePromotion({ allowed }: { readonly allowed: boolean }) {
  if (!allowed) return null;

  return (
    <Promotion heading="Fra Luma Training">
      <p className="m-0">
        Mens du venter på treff: Luma Training publiserer gratis guider om hvordan offentlige
        anskaffelser fungerer, og hva oppdragsgivere faktisk vektlegger.
      </p>
      <p className="m-0 mt-xs">
        <a
          href={lumaUrl('/fagstoff', {
            medium: 'nettsted',
            campaign: 'fagstoff',
            content: 'tom-tilstand',
          })}
        >
          Se guidene
        </a>
      </p>
    </Promotion>
  );
}
