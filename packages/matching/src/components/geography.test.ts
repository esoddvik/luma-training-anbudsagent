import { describe, expect, it } from 'vitest';
import { makeProfile, makeTender } from '../testing/fixtures.js';
import { DEFAULT_MATCH_WEIGHTS } from '../weights.js';
import { NATIONWIDE_LABEL_NB, scoreGeography } from './geography.js';

const weights = DEFAULT_MATCH_WEIGHTS;

describe('scoreGeography', () => {
  it('does not apply when the profile names no places', () => {
    const reason = scoreGeography(
      makeTender({ regions: ['Oslo'], municipalities: ['Oslo'] }),
      makeProfile(),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('does not apply when nothing matches', () => {
    const reason = scoreGeography(
      makeTender({ regions: ['Troms'] }),
      makeProfile({ regionsInclude: ['Oslo'] }),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('awards the whole budget for a municipality match', () => {
    const reason = scoreGeography(
      makeTender({ municipalities: ['Bærum'] }),
      makeProfile({ municipalitiesInclude: ['Bærum'] }),
      weights,
    );
    expect(reason?.contribution).toBe(weights.geography);
  });

  it('scores a region-only match below a municipality match', () => {
    const region = scoreGeography(
      makeTender({ regions: ['Akershus'] }),
      makeProfile({ regionsInclude: ['Akershus'] }),
      weights,
    );
    expect(region?.contribution).toBeLessThan(weights.geography);
    expect(region?.contribution).toBeGreaterThan(0);
  });

  it('matches a profile place inside a longer tender place name', () => {
    const reason = scoreGeography(
      makeTender({ municipalities: ['Bærum kommune'] }),
      makeProfile({ municipalitiesInclude: ['Bærum'] }),
      weights,
    );
    expect(reason?.evidence).toEqual(['Kommune: Bærum kommune', 'Område i profilen: Bærum']);
  });

  it('matches a nationwide notice against any profile geography', () => {
    const reason = scoreGeography(
      makeTender({ regions: ['anyw'] }),
      makeProfile({ regionsInclude: ['Akershus'], municipalitiesInclude: ['Bærum'] }),
      weights,
    );
    expect(reason).not.toBeNull();
    expect(reason?.evidence).toEqual([NATIONWIDE_LABEL_NB]);
    expect(reason?.label).toContain('hele landet');
  });

  it('does not name a region a nationwide notice does not have', () => {
    const reason = scoreGeography(
      makeTender({ regions: ['anyw'] }),
      makeProfile({ regionsInclude: ['Akershus'] }),
      weights,
    );
    expect(reason?.evidence.join(' ')).not.toContain('Akershus');
  });

  it('scores a nationwide notice at region level, not municipality level', () => {
    const nationwide = scoreGeography(
      makeTender({ regions: ['anyw'] }),
      makeProfile({ municipalitiesInclude: ['Bærum'] }),
      weights,
    );
    const local = scoreGeography(
      makeTender({ municipalities: ['Bærum'] }),
      makeProfile({ municipalitiesInclude: ['Bærum'] }),
      weights,
    );
    expect(nationwide?.contribution).toBeLessThan(local?.contribution ?? 0);
    expect(nationwide?.contribution).toBeGreaterThan(0);
  });

  it('matches a municipality-only profile against a region-only notice', () => {
    // Doffin has no municipality field, so this is the normal case, not an edge.
    const reason = scoreGeography(
      makeTender({ regions: ['Oslo'], municipalities: [] }),
      makeProfile({ municipalitiesInclude: ['Oslo'], regionsInclude: [] }),
      weights,
    );
    expect(reason).not.toBeNull();
  });

  it('judges precision by what the tender stated, not by which profile list matched', () => {
    // The profile called it a municipality, but the notice filed it as a region.
    const reason = scoreGeography(
      makeTender({ regions: ['Oslo'], municipalities: [] }),
      makeProfile({ municipalitiesInclude: ['Oslo'] }),
      weights,
    );
    expect(reason?.contribution).toBeLessThan(weights.geography);
    expect(reason?.evidence).toContain('Område: Oslo');
  });

  it('counts a place filed at both levels once', () => {
    const reason = scoreGeography(
      makeTender({ regions: ['Oslo'], municipalities: ['Oslo'] }),
      makeProfile({ regionsInclude: ['Oslo'] }),
      weights,
    );
    expect(reason?.label).toBe('Anbudet gjelder Oslo, som ligger i profilen din');
    expect(reason?.evidence).toEqual(['Kommune: Oslo', 'Område i profilen: Oslo']);
  });

  it('works with raw NUTS codes on both sides', () => {
    const reason = scoreGeography(
      makeTender({ regions: ['NO081'] }),
      makeProfile({ regionsInclude: ['NO081'] }),
      weights,
    );
    expect(reason?.evidence).toContain('Område: NO081');
  });

  it('does not treat the unspecified NUTS code as nationwide', () => {
    const reason = scoreGeography(
      makeTender({ regions: ['NOZZZ'] }),
      makeProfile({ regionsInclude: ['NO081'] }),
      weights,
    );
    expect(reason).toBeNull();
  });

  it('matches in the other direction too, because sources file places inconsistently', () => {
    const reason = scoreGeography(
      makeTender({ municipalities: ['Bergen'] }),
      makeProfile({ municipalitiesInclude: ['Bergen kommune'] }),
      weights,
    );
    expect(reason).not.toBeNull();
  });

  it('lets a profile municipality match a place the source filed as a region', () => {
    const reason = scoreGeography(
      makeTender({ regions: ['Oslo'] }),
      makeProfile({ municipalitiesInclude: ['Oslo'] }),
      weights,
    );
    expect(reason).not.toBeNull();
  });

  it('folds Norwegian characters in place names', () => {
    const reason = scoreGeography(
      makeTender({ municipalities: ['Baerum'] }),
      makeProfile({ municipalitiesInclude: ['Bærum'] }),
      weights,
    );
    expect(reason).not.toBeNull();
  });

  it('is unaffected by the order of the profile places', () => {
    const tender = makeTender({ regions: ['Akershus'], municipalities: ['Bærum'] });
    const forward = scoreGeography(
      tender,
      makeProfile({
        regionsInclude: ['Akershus', 'Oslo'],
        municipalitiesInclude: ['Bærum', 'Asker'],
      }),
      weights,
    );
    const reversed = scoreGeography(
      tender,
      makeProfile({
        regionsInclude: ['Oslo', 'Akershus'],
        municipalitiesInclude: ['Asker', 'Bærum'],
      }),
      weights,
    );
    expect(reversed).toEqual(forward);
  });
});
