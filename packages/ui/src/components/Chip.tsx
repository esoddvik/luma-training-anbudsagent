import type { ButtonHTMLAttributes, HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

/**
 * The pill is the most repeated element in the funnel design: CPV labels, match
 * reasons, region choices, buyer types, value bands. All three variants below
 * share one base class so a chip is the same object everywhere, and only the
 * *behaviour* differs — static text, a removable filter, or a two-state control.
 */
export type ChipTone = 'neutral' | 'soft' | 'outline';

export interface ChipStyleOptions {
  readonly tone?: ChipTone;
  /**
   * Set this — to either value — for a chip that acts as a two-state control.
   * Leaving it `undefined` keeps the static tones. It is three-valued rather
   * than a boolean because an unselected toggle chip and a static chip are not
   * the same object: the toggle carries a border and a pointer affordance it
   * must keep even while off.
   */
  readonly selected?: boolean;
  readonly className?: string;
}

/**
 * Class list for anything that should look like a chip, including anchors.
 * Exported for the same reason as `buttonClassName`: the region selector in the
 * results view has to be real `<Link>`s to the landsdel routes (they exist, and
 * they are what search engines follow), so it needs the toggle-chip styling
 * without a component that renders a `<button>`.
 */
export function chipClassName(options: ChipStyleOptions = {}): string {
  const { tone = 'neutral', selected, className } = options;
  return (
    cx(
      'luma-chip',
      selected === undefined && `luma-chip--${tone}`,
      selected !== undefined && 'luma-chip--toggle',
      selected === true && 'luma-chip--selected',
      className,
    ) ?? 'luma-chip'
  );
}

export interface ChipProps extends Omit<HTMLAttributes<HTMLSpanElement>, 'className'> {
  readonly tone?: ChipTone;
  readonly className?: string;
}

/** Static pill. No interaction, so it renders a `<span>` and never a button. */
export function Chip({ tone, className, children, ...rest }: ChipProps) {
  return (
    <span {...rest} className={chipClassName({ tone, className })}>
      {children}
    </span>
  );
}

export interface RemovableChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'children' | 'type'
> {
  /** Visible text, e.g. a CPV name or a keyword. */
  readonly label: string;
  readonly onRemove?: ButtonHTMLAttributes<HTMLButtonElement>['onClick'];
  /**
   * Overrides the accessible name. Default is `Fjern «{label}»` — a screen
   * reader hearing a list of filters needs to know what each button removes,
   * and «×» tells it nothing.
   */
  readonly removeLabel?: string;
  readonly className?: string;
}

/** Filter chip that removes itself. The `×` is decoration; the label is the name. */
export function RemovableChip({
  label,
  onRemove,
  removeLabel,
  className,
  ...rest
}: RemovableChipProps) {
  return (
    <button
      {...rest}
      type="button"
      onClick={onRemove}
      aria-label={removeLabel ?? `Fjern «${label}»`}
      className={chipClassName({ tone: 'neutral', className: cx('luma-chip--remove', className) })}
    >
      <span className="luma-chip__text">{label}</span>
      <span aria-hidden="true" className="luma-chip__glyph">
        ×
      </span>
    </button>
  );
}

export interface ToggleChipProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'type'
> {
  readonly selected: boolean;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * Two-state filter chip. `aria-pressed` rather than a checkbox role: these sit
 * in a row of independent filters, not in a group where exactly one wins.
 */
export function ToggleChip({ selected, className, children, ...rest }: ToggleChipProps) {
  return (
    <button
      {...rest}
      type="button"
      aria-pressed={selected}
      className={chipClassName({ selected, className })}
    >
      {children}
    </button>
  );
}
