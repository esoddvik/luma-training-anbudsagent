import { describe, expect, it } from 'vitest';
import {
  describeDeadline,
  describeRegions,
  deadlineUrgency,
  excerpt,
  formatCodeList,
  formatEstimatedValue,
  MISSING_DEADLINE_NB,
  NATIONWIDE_NB,
  NOT_PROVIDED_NB,
  PLANNED_NO_DEADLINE_NB,
  UNSPECIFIED_REGION_NB,
} from './format';

/**
 * These tests exist because `docs/spec-deviations.md` records four ways the
 * real Doffin data differs from what the specification assumed, and each one is
 * a chance for the interface to invent something that is not there.
 */

describe('formatEstimatedValue', () => {
  it('sier «Ikke oppgitt» når kilden ikke har noen verdi', () => {
    // Verdien mangler i omtrent halvparten av kunngjøringene. En tom celle
    // eller en null ville lest som «anbudet er verdt ingenting».
    expect(formatEstimatedValue({ min: null, max: null, currency: null })).toBe(NOT_PROVIDED_NB);
    expect(formatEstimatedValue({ min: undefined, max: undefined, currency: 'NOK' })).toBe(
      NOT_PROVIDED_NB,
    );
  });

  it('viser valutaen og antar aldri kroner', () => {
    // PLN forekommer i ekte Doffin-data, og API-et gir ingen omregningskurs.
    expect(formatEstimatedValue({ min: 500_000, max: 500_000, currency: 'PLN' })).toContain('PLN');
    expect(formatEstimatedValue({ min: 500_000, max: 500_000, currency: 'PLN' })).not.toContain(
      'NOK',
    );
  });

  it('viser én verdi som én verdi, ikke som et intervall', () => {
    // Doffin publiserer en skalar; adapteren skriver den til begge grensene.
    // «1 000 000–1 000 000» ville antydet et intervall kilden aldri uttrykte.
    const formatted = formatEstimatedValue({ min: 1_000_000, max: 1_000_000, currency: 'NOK' });
    expect(formatted).not.toContain('–');
    expect(formatted).toContain('NOK');
  });

  it('viser et ekte intervall når grensene er forskjellige', () => {
    expect(formatEstimatedValue({ min: 100, max: 200, currency: 'NOK' })).toContain('–');
  });
});

describe('describeDeadline', () => {
  const now = new Date('2026-08-03T09:00:00Z');

  it('skiller en planlagt anskaffelse fra en manglende frist', () => {
    // En planlagt anskaffelse *har* ingen frist. En konkurranse uten frist er
    // manglende data. De to må ikke lese likt.
    expect(describeDeadline({ deadlineAt: null, isPlanned: true, now })).toEqual({
      kind: 'planned',
      text: PLANNED_NO_DEADLINE_NB,
    });
    expect(describeDeadline({ deadlineAt: null, isPlanned: false, now })).toEqual({
      kind: 'missing',
      text: MISSING_DEADLINE_NB,
    });
  });

  it('regner ut dager igjen fra en oppgitt frist', () => {
    const result = describeDeadline({
      deadlineAt: new Date('2026-08-13T09:00:00Z'),
      isPlanned: false,
      now,
    });
    expect(result.kind).toBe('date');
    if (result.kind === 'date') expect(result.daysLeft).toBe(10);
  });
});

describe('deadlineUrgency', () => {
  it('bruker norsk entall og flertall', () => {
    expect(deadlineUrgency(-1)).toBe('Fristen har gått ut');
    expect(deadlineUrgency(0)).toBe('Frist i dag');
    expect(deadlineUrgency(1)).toBe('1 dag igjen');
    expect(deadlineUrgency(5)).toBe('5 dager igjen');
  });
});

describe('describeRegions', () => {
  it('oversetter «anyw» til hele landet', () => {
    // `anyw` er ikke en NUTS-kode og er den vanligste verdien i datasettet.
    // Den må aldri skrives ut rå.
    expect(describeRegions(['anyw'])).toBe(NATIONWIDE_NB);
    expect(describeRegions(['NO081', 'anyw'])).toBe(NATIONWIDE_NB);
  });

  it('sier fra når geografien er uspesifisert', () => {
    expect(describeRegions(['NOZZZ'])).toBe(UNSPECIFIED_REGION_NB);
  });

  it('sier «Ikke oppgitt» når kunngjøringen ikke har noen region', () => {
    expect(describeRegions([])).toBe(NOT_PROVIDED_NB);
  });

  it('lister ekte NUTS-koder', () => {
    expect(describeRegions(['NO081', 'NO082'])).toBe('NO081, NO082');
  });
});

describe('formatCodeList', () => {
  it('sier «Ikke oppgitt» for en tom liste', () => {
    expect(formatCodeList([])).toBe(NOT_PROVIDED_NB);
  });
});

describe('excerpt', () => {
  it('gir undefined for tom eller manglende tekst', () => {
    expect(excerpt(null)).toBeUndefined();
    expect(excerpt('   ')).toBeUndefined();
  });

  it('kutter ikke midt i et ord', () => {
    const long = `${'ord '.repeat(100)}slutt`;
    const result = excerpt(long, 50);
    expect(result).toBeDefined();
    expect(result!.endsWith('…')).toBe(true);
    expect(result!.length).toBeLessThanOrEqual(51);
  });
});
