import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from '../utils/cx.js';

export type AlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

export interface AlertProps extends HTMLAttributes<HTMLDivElement> {
  readonly tone?: AlertTone;
  readonly heading?: ReactNode;
  readonly titleLevel?: 2 | 3 | 4;
  /**
   * Set for messages that appear after page load (validation summaries, save
   * confirmations) so assistive technology announces them. Leave off for
   * static explanatory callouts — a live region that never changes is noise.
   */
  readonly live?: 'polite' | 'assertive';
}

export function Alert({
  tone = 'neutral',
  heading,
  titleLevel = 3,
  live,
  className,
  children,
  ...rest
}: AlertProps) {
  const Heading = `h${titleLevel}` as const;
  const role = live === 'assertive' ? 'alert' : live === 'polite' ? 'status' : undefined;

  return (
    <div
      {...rest}
      {...(role === undefined ? {} : { role })}
      {...(live === undefined ? {} : { 'aria-live': live })}
      className={cx('luma-alert', `luma-alert--${tone}`, className)}
    >
      {heading === undefined ? null : <Heading className="luma-alert__title">{heading}</Heading>}
      <div className="luma-alert__body">{children}</div>
    </div>
  );
}

/** Alias: a non-announcing Alert used purely as an explanatory callout. */
export const Callout = Alert;
