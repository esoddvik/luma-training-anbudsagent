import type {
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import { cx } from '../utils/cx.js';

export type InputProps = InputHTMLAttributes<HTMLInputElement>;

export function Input({ className, type = 'text', ...rest }: InputProps) {
  return <input {...rest} type={type} className={cx('luma-input', className)} />;
}

export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;

export function Textarea({ className, rows = 4, ...rest }: TextareaProps) {
  return <textarea {...rest} rows={rows} className={cx('luma-textarea', className)} />;
}

export type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

export function Select({ className, children, ...rest }: SelectProps) {
  return (
    <select {...rest} className={cx('luma-select', className)}>
      {children}
    </select>
  );
}

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  /** Visible label text. Rendered inside the `<label>`, so no `htmlFor` needed. */
  readonly label: ReactNode;
  readonly wrapperClassName?: string;
}

export function Checkbox({ label, wrapperClassName, className, ...rest }: CheckboxProps) {
  return (
    <label className={cx('luma-checkbox', wrapperClassName)}>
      <input {...rest} type="checkbox" className={cx('luma-checkbox__control', className)} />
      <span className="luma-checkbox__text">{label}</span>
    </label>
  );
}
