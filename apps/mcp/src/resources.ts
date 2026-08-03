/**
 * MCP resources (spec §33).
 *
 * Named after the phases of Luma's tender playbook so that course alumni
 * recognise the method and new users meet it. The naming is a product
 * decision, not a technical one: spec §4.6 requires functionality to be
 * placeable in the playbook.
 *
 * What is deliberately absent: the prompt library from the paid course. Spec
 * §33 forbids exposing private course material without an entitlement, and
 * entitlement-gated access is a phase 7 candidate.
 */

export interface LumaResource {
  uri: string;
  name: string;
  title: string;
  description: string;
  mimeType: 'text/markdown';
  text: string;
}

const PHASE_1_UTVELGELSE = `# Fase 1: Utvelgelse

Målet med denne fasen er å bruke tiden på de konkurransene dere faktisk kan vinne, og å legge fra dere resten uten dårlig samvittighet.

## Spørsmålene som avgjør

1. **Er dette arbeid vi gjør i dag?** Ikke arbeid vi kunne gjort. Arbeid vi har levert, med referanser som er relevante for denne oppdragsgiveren.
2. **Har vi kapasitet i perioden?** Både til å skrive tilbudet og til å levere hvis vi vinner.
3. **Kjenner vi oppdragsgiveren?** Har dere levert til dem før, eller til noen som ligner nok til at referansen teller?
4. **Er størrelsen riktig?** For små kontrakter spiser tilbudsarbeidet marginen. For store kan kvalifikasjonskravene være ute av rekkevidde.
5. **Er fristen realistisk?** Et godt tilbud på tre uker slår et forhastet tilbud på fem dager.

## Hva et treff i denne tjenesten betyr

Treffscoren sier hvor godt anbudet passer kriteriene i varslingsprofilen. Den sier ingenting om sannsynligheten for å vinne, og den er ikke en anbefaling om å levere. Bruk den til å prioritere hva dere leser først, ikke til å bestemme hva dere leverer på.

Begrunnelsene bak scoren er regelbaserte og etterprøvbare: matchende CPV-koder, søkeord, geografi, oppdragsgiver, verdiintervall og konkurransetype. Be om forklaringen når du er i tvil.

## Planlagte anskaffelser

Veiledende kunngjøringer og intensjonskunngjøringer forteller at noe er på vei før konkurransen er publisert. Det er det beste tidspunktet å ta kontakt med oppdragsgiveren, stille spørsmål i markedsdialogen og forberede referanser. Konkurransen har ingen frist ennå, så det haster ikke på samme måte, men forspranget er reelt.`;

const PHASE_2_KRAV = `# Fase 2: Krav- og oppdragsforståelse

Målet er å vite hva som faktisk kreves, før dere skriver en eneste setning tilbudstekst.

## Skill de tre tingene fra hverandre

1. **Kvalifikasjonskrav.** Dette er inngangsbilletten. Enten oppfyller dere dem eller så gjør dere det ikke. Sjekk disse først, fordi et manglende kvalifikasjonskrav gjør resten av arbeidet bortkastet.
2. **Tildelingskriterier.** Dette er det dere konkurrerer på, med vekting. Her ligger poengene.
3. **Kravspesifikasjonen.** Dette er hva som skal leveres. Det er ikke det samme som det dere får poeng for.

En vanlig og dyr feil er å skrive langt og godt om noe som ikke er et tildelingskriterium.

## Les vektingen som et budsjett

Hvis pris teller 40 prosent og kvalitet 60, er det ikke det samme som at kvalitet er viktigst. Se på hvor stor spredning det faktisk er mellom tilbyderne på hver akse. Et kriterium alle scorer likt på avgjør ingenting, uansett vekt.

## Noter det dere ikke vet

Skriv ned spørsmålene mens dere leser. Spørsmålsfristen kommer alltid før tilbudsfristen, og et godt spørsmål kan endre en formulering som ellers ville utelukket dere.

## En begrensning du må kjenne

Spørsmål og svar i en konkurranse skjer i oppdragsgivers eget konkurranseverktøy, ikke på Doffin. Denne tjenesten ser dem ikke. Følg konkurransens egen kommunikasjonskanal selv.`;

const BID_NO_BID = `# Bid/no-bid

En bid/no-bid-beslutning er en beslutning om hvor dere bruker kapasiteten deres. Den handler like mye om hva dere sier nei til.

## Grunnlaget

- **Treffer oppdraget kjernevirksomheten?** Ikke om dere kan levere, men om dere er blant de beste til å levere akkurat dette.
- **Har dere referansene som kreves?** Konkret, mot kravene i konkurransen.
- **Hva koster tilbudet å skrive?** I timer, fra folk som ellers ville fakturert.
- **Hva er alternativkostnaden?** Hvilken annen konkurranse taper dere ved å prioritere denne?
- **Hvem konkurrerer dere mot?** Og hva er deres realistiske posisjon mot dem?
- **Hva skjer hvis dere vinner?** Kapasitet, bemanning, risiko i kontrakten.

## Å si nei er et resultat

Et velbegrunnet nei frigjør tid til en konkurranse dere kan vinne. Loggfør beslutningen og begrunnelsen. Over tid ser dere mønsteret i hva dere faktisk vinner, og utvelgelsen i fase 1 blir bedre.

## Dette er brukerens beslutning

Verken denne tjenesten eller et AI-verktøy skal ta den for dere. Et verktøy kan strukturere grunnlaget og stille spørsmålene. Vurderingen er deres.`;

const SERVICE_ABOUT = `# Om Luma Anbudsvarsling

En gratis tjeneste fra Luma Training som varsler norske leverandører om offentlige anbud som passer kriteriene deres.

## Slik fungerer matchingen

Brukeren beskriver hva virksomheten leverer, i en varslingsprofil: CPV-koder, søkeord, geografi, oppdragsgivere, verdiintervall og konkurransetyper. Hvert anbud fra Doffin sammenlignes deterministisk mot profilen, og hvert treff får en score med begrunnelser som kan etterprøves.

Matchingen er regelbasert. Ingen språkmodell er involvert i å bestemme hva brukeren får se.

## Hva scoren betyr, og ikke betyr

Scoren måler hvor godt anbudet passer varslingsprofilen. Den er ikke en sannsynlighet for å vinne, og den er ikke en anbefaling om å levere tilbud.

## Tillitskontrakten

- Kommersielle hensyn påvirker aldri hvilke anbud som rangeres høyest.
- Anbudsdata holdes ikke tilbake for å presse frem kjøp.
- Markedsføring er tydelig atskilt fra anbudsdata, og kan slås av.
- Kildedata er sporbare tilbake til Doffin.`;

const SERVICE_MATCH_SCORING = `# Slik beregnes treffscoren

Scoren er en sum av regelbaserte komponenter, hver med en øvre grense:

| Komponent | Maks | Hva den måler |
| --- | --- | --- |
| CPV | 35 | Samsvar mellom anbudets CPV-koder og profilens, der en mer spesifikk match teller mer |
| Søkeord | 25 | Treff på hele ord og fraser i tittel og beskrivelse |
| Geografi | 15 | Samsvar mellom anbudets område og profilens |
| Oppdragsgiver | 10 | Om oppdragsgiveren står på profilens liste |
| Verdi | 5 | Om anslått verdi ligger innenfor profilens intervall |
| Type og prosedyre | 5 | Konkurransetype, inkludert planlagt anskaffelse |
| Frist | 5 | Hvor mye tid som faktisk er igjen |

## Harde eksklusjoner

Noen forhold utelukker et anbud uansett score: ekskludert CPV-kode, søkeord eller oppdragsgiver, geografi utenfor profilen, verdi utenfor intervallet, og konkurranser som er stengt, avlyst eller utløpt. Eksklusjon slår alltid inkludering.

## Planlagte anskaffelser

En planlagt anskaffelse har ingen frist. Fristkomponenten hoppes over uten å trekke ned scoren.

## Versjonering

Algoritmen er versjonert. Samme versjon og samme inndata gir alltid samme resultat, og begrunnelsene lagres sammen med versjonen de ble beregnet under.

## Det scoren aldri inneholder

Ingen kommersielle signaler. Kursklikk, nyhetsbrevabonnement og annen Luma-aktivitet inngår ikke i beregningen, verken direkte eller indirekte.`;

const SERVICE_BEGRENSNINGER = `# Hva tjenesten ikke ser

Disse begrensningene er strukturelle. De forsvinner ikke med en oppdatering.

## 1. Spørsmål og svar i konkurransen

Spørsmål, svar og tilleggsinformasjon lever i oppdragsgivers konkurransegjennomføringsverktøy (Mercell, EU-Supply, TendSign og andre), og eksponeres ikke via Doffin. Tjenesten fanger formelle endringer og rettelser som publiseres på Doffin, ikke kommunikasjonsstrømmen i konkurransen.

**Følg alltid konkurransens egen kommunikasjonskanal selv.**

## 2. Anskaffelser under terskelverdi

Mange anskaffelser under de nasjonale terskelverdiene publiseres aldri på Doffin. At du ikke får varsel, betyr ikke at det ikke finnes muligheter.

## 3. Geografisk dekning

Tjenesten dekker kunngjøringer publisert på Doffin, altså Norge. Nordiske og europeiske markeder (TED) er ikke dekket.

## 4. Kommunale beslutningssignaler

Kommunestyremøter, budsjetter og investeringsplaner overvåkes ikke. Slike signaler krever egen datainnhenting og redaksjonelt arbeid.`;

export const LUMA_RESOURCES: readonly LumaResource[] = [
  {
    uri: 'luma://playbook/fase-1-utvelgelse',
    name: 'playbook-fase-1-utvelgelse',
    title: 'Playbook fase 1: Utvelgelse',
    description:
      'Hvordan velge hvilke konkurranser som er verdt tid, og hva et treff i tjenesten betyr.',
    mimeType: 'text/markdown',
    text: PHASE_1_UTVELGELSE,
  },
  {
    uri: 'luma://playbook/fase-2-krav-og-oppdragsforstaelse',
    name: 'playbook-fase-2-krav-og-oppdragsforstaelse',
    title: 'Playbook fase 2: Krav- og oppdragsforståelse',
    description:
      'Skillet mellom kvalifikasjonskrav, tildelingskriterier og kravspesifikasjon, og hvordan lese vektingen.',
    mimeType: 'text/markdown',
    text: PHASE_2_KRAV,
  },
  {
    uri: 'luma://methodology/bid-no-bid',
    name: 'methodology-bid-no-bid',
    title: 'Metodikk: bid/no-bid',
    description: 'Grunnlaget for å bestemme om dere skal levere tilbud, og hvorfor et nei teller.',
    mimeType: 'text/markdown',
    text: BID_NO_BID,
  },
  {
    uri: 'luma://service/about',
    name: 'service-about',
    title: 'Om tjenesten',
    description: 'Hva Luma Anbudsvarsling gjør, og tillitskontrakten den er bygget på.',
    mimeType: 'text/markdown',
    text: SERVICE_ABOUT,
  },
  {
    uri: 'luma://service/match-scoring',
    name: 'service-match-scoring',
    title: 'Slik beregnes treffscoren',
    description: 'Komponentene i scoren, de harde eksklusjonene, og hva scoren aldri inneholder.',
    mimeType: 'text/markdown',
    text: SERVICE_MATCH_SCORING,
  },
  {
    uri: 'luma://service/begrensninger',
    name: 'service-begrensninger',
    title: 'Kjente begrensninger',
    description: 'Hva tjenesten ikke ser, og hva brukeren derfor må følge opp selv.',
    mimeType: 'text/markdown',
    text: SERVICE_BEGRENSNINGER,
  },
];

export function findResource(uri: string): LumaResource | undefined {
  return LUMA_RESOURCES.find((resource) => resource.uri === uri);
}
