/**
 * Pure id/ARIA wiring for the `Field` wrapper.
 *
 * Kept free of JSX so it can be unit tested without a DOM, and so the
 * association between label, hint and error message is verified rather than
 * eyeballed. Section 16 requires keyboard navigation; a hint that is rendered
 * but not announced is a silent accessibility regression.
 */

export interface FieldIds {
  readonly controlId: string;
  readonly hintId: string;
  readonly errorId: string;
}

export function fieldIds(id: string): FieldIds {
  if (id.trim().length === 0) {
    throw new Error('Field krever en ikke-tom id.');
  }
  return {
    controlId: id,
    hintId: `${id}-hjelpetekst`,
    errorId: `${id}-feilmelding`,
  };
}

export interface FieldControlOptions {
  readonly id: string;
  readonly hasHint: boolean;
  readonly hasError: boolean;
  readonly required?: boolean;
}

export interface FieldControlProps {
  readonly id: string;
  readonly 'aria-describedby'?: string;
  readonly 'aria-invalid'?: true;
  readonly required?: true;
}

/**
 * Builds the props the control inside a `Field` must receive.
 *
 * The error id comes first in `aria-describedby` so screen readers announce
 * what is wrong before the hint that explains the format.
 */
export function fieldControlProps(options: FieldControlOptions): FieldControlProps {
  const ids = fieldIds(options.id);
  const describedBy: string[] = [];

  if (options.hasError) describedBy.push(ids.errorId);
  if (options.hasHint) describedBy.push(ids.hintId);

  return {
    id: ids.controlId,
    ...(describedBy.length > 0 ? { 'aria-describedby': describedBy.join(' ') } : {}),
    ...(options.hasError ? { 'aria-invalid': true as const } : {}),
    ...(options.required ? { required: true as const } : {}),
  };
}
