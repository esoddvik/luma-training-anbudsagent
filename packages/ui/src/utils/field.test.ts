import { describe, expect, it } from 'vitest';
import { fieldControlProps, fieldIds } from './field.js';

describe('fieldIds', () => {
  it('derives hint and error ids from the control id', () => {
    expect(fieldIds('epost')).toEqual({
      controlId: 'epost',
      hintId: 'epost-hjelpetekst',
      errorId: 'epost-feilmelding',
    });
  });

  it('rejects an empty id, which would silently break the label association', () => {
    expect(() => fieldIds('')).toThrow(/id/);
    expect(() => fieldIds('   ')).toThrow(/id/);
  });
});

describe('fieldControlProps', () => {
  it('omits aria-describedby when there is neither hint nor error', () => {
    expect(fieldControlProps({ id: 'epost', hasHint: false, hasError: false })).toEqual({
      id: 'epost',
    });
  });

  it('points aria-describedby at the hint', () => {
    expect(fieldControlProps({ id: 'epost', hasHint: true, hasError: false })).toEqual({
      id: 'epost',
      'aria-describedby': 'epost-hjelpetekst',
    });
  });

  it('announces the error before the hint', () => {
    expect(fieldControlProps({ id: 'epost', hasHint: true, hasError: true })).toEqual({
      id: 'epost',
      'aria-describedby': 'epost-feilmelding epost-hjelpetekst',
      'aria-invalid': true,
    });
  });

  it('marks the control invalid only when there is an error', () => {
    expect(fieldControlProps({ id: 'epost', hasHint: false, hasError: false })).not.toHaveProperty(
      'aria-invalid',
    );
    expect(fieldControlProps({ id: 'epost', hasHint: false, hasError: true })).toHaveProperty(
      'aria-invalid',
      true,
    );
  });

  it('passes required through only when set', () => {
    expect(
      fieldControlProps({ id: 'epost', hasHint: false, hasError: false, required: false }),
    ).not.toHaveProperty('required');
    expect(
      fieldControlProps({ id: 'epost', hasHint: false, hasError: false, required: true }),
    ).toHaveProperty('required', true);
  });
});
