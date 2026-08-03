import { describe, expect, it } from 'vitest';
import { cx } from './cx.js';

describe('cx', () => {
  it('joins truthy class names', () => {
    expect(cx('luma-button', 'luma-button--primary')).toBe('luma-button luma-button--primary');
  });

  it('drops false, null and undefined', () => {
    expect(cx('a', false, null, undefined, 'b')).toBe('a b');
  });

  it('drops empty and whitespace-only strings', () => {
    expect(cx('', '   ', 'a')).toBe('a');
  });

  it('trims each entry', () => {
    expect(cx('  a  ', ' b')).toBe('a b');
  });

  it('returns undefined when nothing is left, so React omits the attribute', () => {
    expect(cx()).toBeUndefined();
    expect(cx(false, undefined, '  ')).toBeUndefined();
  });
});
