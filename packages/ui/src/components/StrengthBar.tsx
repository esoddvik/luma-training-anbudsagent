import { cx } from '../utils/cx.js';

export type StrengthLevel = 'sterk' | 'middels' | 'svak';

/** The word the reader sees. Spec 4.3: match strength is expressed in words. */
const LEVEL_WORD: Readonly<Record<StrengthLevel, string>> = {
  sterk: 'Sterk',
  middels: 'Middels',
  svak: 'Svak',
};

export interface StrengthBarProps {
  /** What matched, e.g. «CPV-kode» or «Nøkkelord i tittel». */
  readonly label: string;
  readonly level: StrengthLevel;
  /** One line of evidence, e.g. «Traff 90911300 – Rengjøring». */
  readonly evidence?: string;
  readonly className?: string;
}

/**
 * A reason row: what matched, how strongly, and the evidence for it.
 *
 * **This component must never render a number or a percentage.** Spec 4.3
 * forbids showing a match score — strength is `Sterk` / `Middels` / `Svak` and
 * nothing else, because a number invites the reader to treat a heuristic as a
 * measurement and to compare two notices that were never scored on one scale.
 * The design draws percentage bars; we draw three fixed widths keyed to the
 * word, and the widths live in `styles.css` so no number passes through here at
 * all.
 *
 * The bar is therefore decoration: it is `aria-hidden`, and the word is the
 * accessible text. A screen reader gets exactly what the sighted reader gets.
 */
export function StrengthBar({ label, level, evidence, className }: StrengthBarProps) {
  return (
    <div className={cx('luma-strength', className)}>
      <p className="luma-strength__row">
        <span className="luma-strength__label">{label}</span>
        <span className="luma-strength__level">{LEVEL_WORD[level]}</span>
      </p>
      <span aria-hidden="true" className="luma-strength__track">
        <span className={`luma-strength__fill luma-strength__fill--${level}`} />
      </span>
      {evidence === undefined ? null : <p className="luma-strength__evidence">{evidence}</p>}
    </div>
  );
}
