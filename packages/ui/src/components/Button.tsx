import type { ButtonHTMLAttributes } from 'react';
import { cx } from '../utils/cx.js';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md';

export interface ButtonStyleOptions {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  readonly fullWidth?: boolean;
  readonly className?: string;
}

/**
 * Class list for anything that should look like a button, including anchors.
 * Exported so `<a>` links can share the exact button styling without a
 * component that renders the wrong element.
 */
export function buttonClassName(options: ButtonStyleOptions = {}): string {
  const { variant = 'primary', size = 'md', fullWidth = false, className } = options;
  return (
    cx(
      'luma-button',
      `luma-button--${variant}`,
      size === 'sm' && 'luma-button--sm',
      fullWidth && 'luma-button--full',
      className,
    ) ?? 'luma-button'
  );
}

export interface ButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'>, ButtonStyleOptions {}

export function Button({
  variant,
  size,
  fullWidth,
  className,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      {...rest}
      type={type}
      className={buttonClassName({ variant, size, fullWidth, className })}
    />
  );
}
