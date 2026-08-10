import { describe, expect, it } from 'vitest';
import { chipClassName } from './Chip.js';

/**
 * `chipClassName` is the only part of the chip primitives that carries logic,
 * and its `selected` option is three-valued on purpose: `undefined` means "not a
 * control", which is a different chip from an unselected toggle. That
 * distinction is invisible in the JSX and would break silently, so it is the
 * thing worth testing. The rendered markup is left to the app's own e2e run —
 * this package has no DOM environment and does not need one for a pure string.
 */
describe('chipClassName', () => {
  it('defaults to the neutral static tone', () => {
    expect(chipClassName()).toBe('luma-chip luma-chip--neutral');
  });

  it('applies the requested static tone', () => {
    expect(chipClassName({ tone: 'soft' })).toBe('luma-chip luma-chip--soft');
    expect(chipClassName({ tone: 'outline' })).toBe('luma-chip luma-chip--outline');
  });

  it('drops the static tone once the chip is a control', () => {
    expect(chipClassName({ selected: false })).toBe('luma-chip luma-chip--toggle');
    expect(chipClassName({ selected: true })).toBe(
      'luma-chip luma-chip--toggle luma-chip--selected',
    );
  });

  it('appends caller classes last so they can override', () => {
    expect(chipClassName({ selected: true, className: 'sticky-rail' })).toBe(
      'luma-chip luma-chip--toggle luma-chip--selected sticky-rail',
    );
  });
});
