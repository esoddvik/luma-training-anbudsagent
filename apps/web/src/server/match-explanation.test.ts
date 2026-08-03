import { describe, expect, it } from 'vitest';
import { CONFIDENCE_LABEL_NB, SCORE_DISCLAIMER_NB, type MatchReasonType } from '@luma/domain';
import {
  buildMatchExplanation,
  REASON_TYPE_LABEL_NB,
  simplifyForSharing,
  type StoredReasonRow,
} from './match-explanation';

const rows: StoredReasonRow[] = [
  {
    entryType: 'reason',
    typeKey: 'cpv',
    label: 'Anbudet har CPV-koder du følger',
    evidence: ['45000000'],
  },
  {
    entryType: 'reason',
    typeKey: 'keyword',
    label: 'Anbudet nevner søkeord fra profilen din',
    evidence: ['totalentreprise'],
  },
  {
    entryType: 'exclusion',
    typeKey: 'buyer_excluded',
    label: 'Oppdragsgiveren står på eksklusjonslisten din',
    evidence: ['Testetaten'],
  },
];

describe('buildMatchExplanation', () => {
  it('skiller begrunnelser fra eksklusjoner', () => {
    const explanation = buildMatchExplanation({
      confidence: 'high',
      matchingVersion: '1.0.0',
      rows,
    });

    expect(explanation.reasons).toHaveLength(2);
    expect(explanation.exclusions).toHaveLength(1);
    expect(explanation.exclusions[0]?.label).toContain('eksklusjonslisten');
  });

  it('bruker den godkjente relevansformuleringen og har med forbeholdet', () => {
    // Spec 4.3: en score er aldri en vinnersannsynlighet. Formuleringen kommer
    // fra domenet, og forbeholdet følger med i samme objekt, slik at en flate
    // ikke kan vise det ene uten å ha det andre for hånden.
    const explanation = buildMatchExplanation({
      confidence: 'medium',
      matchingVersion: '1.0.0',
      rows: [],
    });

    expect(explanation.confidenceText).toBe(CONFIDENCE_LABEL_NB.medium);
    expect(explanation.disclaimer).toBe(SCORE_DISCLAIMER_NB);
  });

  it('sier at vurderingen er regelbasert, ikke AI-tolket', () => {
    // Spec 4.2 krever at skillet mellom regelbasert matching og AI-tolkning er
    // synlig. Det finnes ingen AI i MVP (spec 41), så teksten sier det rett ut.
    const explanation = buildMatchExplanation({
      confidence: 'low',
      matchingVersion: '1.0.0',
      rows: [],
    });
    expect(explanation.method).toContain('regelbasert');
    expect(explanation.method).toContain('Ingen AI-modell');
  });
});

describe('simplifyForSharing', () => {
  it('gir bare typenavn, aldri verdiene bak dem', () => {
    // Spec 17: delt-visningen viser begrunnelsestypene, ikke profilkriteriene.
    const simplified = simplifyForSharing(['cpv', 'keyword']);
    expect(simplified.labels).toEqual([REASON_TYPE_LABEL_NB.cpv, REASON_TYPE_LABEL_NB.keyword]);
    expect(JSON.stringify(simplified)).not.toContain('totalentreprise');
    expect(JSON.stringify(simplified)).not.toContain('45000000');
  });

  it('fjerner duplikater og beholder rekkefølgen', () => {
    expect(simplifyForSharing(['cpv', 'cpv', 'geography']).reasonTypes).toEqual([
      'cpv',
      'geography',
    ]);
  });

  it('forkaster ukjente typer i stedet for å slippe dem gjennom', () => {
    const simplified = simplifyForSharing(['cpv', 'noe-ukjent' as MatchReasonType]);
    expect(simplified.reasonTypes).toEqual(['cpv']);
    expect(simplified.labels).toHaveLength(1);
  });

  it('har en norsk etikett for hver begrunnelsestype i domenet', () => {
    // En manglende etikett ville blitt `undefined` på en offentlig side.
    const allTypes: MatchReasonType[] = [
      'cpv',
      'keyword',
      'geography',
      'buyer',
      'value',
      'notice_type',
      'procedure',
      'deadline',
    ];
    for (const type of allTypes) {
      expect(REASON_TYPE_LABEL_NB[type]).toBeTypeOf('string');
      expect(REASON_TYPE_LABEL_NB[type].length).toBeGreaterThan(0);
    }
    expect(simplifyForSharing(allTypes).labels).toHaveLength(allTypes.length);
  });
});
