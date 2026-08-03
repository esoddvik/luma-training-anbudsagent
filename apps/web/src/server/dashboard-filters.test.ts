import { describe, expect, it } from 'vitest';
import { hasActiveFilters, parseDashboardFilters } from './dashboard-filters';
import { escapeLike, significantCpvDigits } from './tenders';

describe('parseDashboardFilters', () => {
  it('leser gyldige filtre fra spørrestrengen', () => {
    const filters = parseDashboardFilters({
      profil: '3f8b0e4a-2c1d-4f6a-9b7e-8d5c1a2b3c4d',
      frist: '14',
      oppdragsgiver: 'Oslo kommune',
      cpv: '45000000',
      status: 'saved',
      kategori: 'planned',
    });

    expect(filters).toEqual({
      profileId: '3f8b0e4a-2c1d-4f6a-9b7e-8d5c1a2b3c4d',
      deadlineWithinDays: 14,
      buyer: 'Oslo kommune',
      cpv: '45000000',
      state: 'saved',
      category: 'planned',
    });
  });

  it('forkaster verdier som ikke er kjente valg', () => {
    // En håndredigert URL må ikke kunne utvide spørringen.
    const filters = parseDashboardFilters({
      profil: 'ikke-en-uuid',
      frist: '9999',
      status: 'alle',
      kategori: 'hva-som-helst',
    });

    expect(filters.profileId).toBeUndefined();
    expect(filters.deadlineWithinDays).toBeUndefined();
    expect(filters.state).toBeUndefined();
    expect(filters.category).toBeUndefined();
  });

  it('behandler tomme verdier som fravær av filter', () => {
    expect(parseDashboardFilters({ oppdragsgiver: '', cpv: '' }).buyer).toBeUndefined();
    expect(hasActiveFilters(parseDashboardFilters({}))).toBe(false);
  });

  it('tar første ikke-tomme verdi når parameteren gjentas', () => {
    expect(parseDashboardFilters({ oppdragsgiver: ['', 'Bergen kommune'] }).buyer).toBe(
      'Bergen kommune',
    );
  });
});

describe('significantCpvDigits', () => {
  it('gjør en overordnet kode til et prefiks, slik at hierarkiet virker', () => {
    // Spec 11.1: en profil som ber om 45000000 skal også treffe 45213316.
    expect(significantCpvDigits('45000000')).toBe('45');
    expect(significantCpvDigits('45210000')).toBe('4521');
    expect(significantCpvDigits('45213316')).toBe('45213316');
  });

  it('tåler kontrollsiffer og mellomrom', () => {
    expect(significantCpvDigits(' 45000000-7 ')).toBe('45');
  });

  it('avviser alt som ikke er siffer, så et filter ikke blir et jokertegn', () => {
    expect(significantCpvDigits('45%')).toBeUndefined();
    expect(significantCpvDigits('_')).toBeUndefined();
    expect(significantCpvDigits('')).toBeUndefined();
    expect(significantCpvDigits('123456789')).toBeUndefined();
  });
});

describe('escapeLike', () => {
  it('gjør LIKE-metategn til vanlige tegn', () => {
    expect(escapeLike('100 % kommune')).toBe('100 \\% kommune');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c\\d')).toBe('c\\\\d');
  });
});
