import { describe, expect, it } from 'vitest';
import { loginPath, safeReturnPath } from './return-path';

describe('safeReturnPath', () => {
  it('godtar en vanlig sti i tjenesten', () => {
    expect(safeReturnPath('/oversikt')).toBe('/oversikt');
    expect(safeReturnPath('/anbud/abc?melding=lagret')).toBe('/anbud/abc?melding=lagret');
  });

  it('avviser tomme og manglende verdier', () => {
    expect(safeReturnPath(undefined)).toBeUndefined();
    expect(safeReturnPath(null)).toBeUndefined();
    expect(safeReturnPath('')).toBeUndefined();
  });

  it('avviser absolutte URL-er til andre verter', () => {
    expect(safeReturnPath('https://ondsinnet.example/logg-inn')).toBeUndefined();
    expect(safeReturnPath('http://ondsinnet.example')).toBeUndefined();
  });

  it('avviser protokollrelative URL-er', () => {
    // `//ondsinnet.example` er en absolutt URL, ikke en sti. En sjekk som bare
    // ser etter en innledende skråstrek slipper den rett gjennom.
    expect(safeReturnPath('//ondsinnet.example')).toBeUndefined();
    expect(safeReturnPath('/\\ondsinnet.example')).toBeUndefined();
    expect(safeReturnPath('/legitim\\..\\ondsinnet.example')).toBeUndefined();
  });
});

describe('loginPath', () => {
  it('tar med returstien når den er trygg', () => {
    expect(loginPath('/oversikt')).toBe('/logg-inn?retur=%2Foversikt');
  });

  it('faller tilbake til ren innloggingsside for utrygge verdier', () => {
    expect(loginPath('https://ondsinnet.example')).toBe('/logg-inn');
    expect(loginPath(undefined)).toBe('/logg-inn');
  });
});
