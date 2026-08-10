import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';

export interface ToggleProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'className' | 'type' | 'role' | 'aria-checked' | 'onChange' | 'children'
> {
  readonly checked: boolean;
  /** Called with the value the switch would move to. */
  readonly onChange?: (next: boolean) => void;
  /** Visible text beside the switch, e.g. «Ta med planlagte anskaffelser». */
  readonly label: string;
  /**
   * Supply one when the label needs to be a separate node in the accessibility
   * tree — the switch then points at it with `aria-labelledby`. Without it the
   * label text is copied onto the button as `aria-label`, which is equivalent
   * for a reader and keeps the component hook-free (no `useId`, so this still
   * renders as a server component).
   */
  readonly id?: string;
  readonly className?: string;
}

/**
 * A switch, not a checkbox: the design draws a track and a knob, and a styled
 * `<input type="checkbox">` cannot carry that reliably across browsers. Because
 * it is a `<button role="switch">` there is no `<label for>` — the accessible
 * name comes from the button itself, and the visible text is wired to it rather
 * than the other way round.
 */
export function Toggle({ checked, onChange, label, id, className, ...rest }: ToggleProps) {
  const labelId = id === undefined ? undefined : `${id}-label`;

  return (
    <span className={cx('luma-toggle', className)}>
      <button
        {...rest}
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={labelId === undefined ? label : undefined}
        aria-labelledby={labelId}
        onClick={() => onChange?.(!checked)}
        className="luma-toggle__control"
      >
        <span aria-hidden="true" className="luma-toggle__track">
          <span className="luma-toggle__knob" />
        </span>
      </button>
      <span id={labelId} className="luma-toggle__label">
        {label}
      </span>
    </span>
  );
}
