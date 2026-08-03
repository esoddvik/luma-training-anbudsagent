import type { ReactNode } from 'react';
import { cx } from '../utils/cx.js';
import { fieldControlProps, fieldIds, type FieldControlProps } from '../utils/field.js';

export interface FieldProps {
  /** Id of the control. Also seeds the hint and error ids. */
  readonly id: string;
  readonly label: ReactNode;
  readonly hint?: ReactNode;
  readonly error?: ReactNode;
  readonly required?: boolean;
  readonly className?: string;
  /**
   * Render prop. `Field` hands the control the id, `aria-describedby`,
   * `aria-invalid` and `required` it needs, so the wiring cannot fall out of
   * sync with what is actually rendered.
   */
  readonly children: (controlProps: FieldControlProps) => ReactNode;
}

export function Field({
  id,
  label,
  hint,
  error,
  required = false,
  className,
  children,
}: FieldProps) {
  const ids = fieldIds(id);
  const hasHint = hint !== undefined && hint !== null && hint !== false;
  const hasError = error !== undefined && error !== null && error !== false;
  const controlProps = fieldControlProps({ id, hasHint, hasError, required });

  return (
    <div className={cx('luma-field', className)}>
      <label className="luma-field__label" htmlFor={ids.controlId}>
        {label}
        {required ? (
          <span className="luma-field__required" aria-hidden="true">
            {' *'}
          </span>
        ) : null}
        {required ? <span className="luma-visually-hidden"> (påkrevd)</span> : null}
      </label>
      {hasHint ? (
        <p className="luma-field__hint" id={ids.hintId}>
          {hint}
        </p>
      ) : null}
      {children(controlProps)}
      {hasError ? (
        <p className="luma-field__error" id={ids.errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
