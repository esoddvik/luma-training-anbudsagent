<!--
A tracked copy. This document is authored in Rable, in the note titled
"Luma Anbudsvarsling IDE Agent Spec v3: Søk-først, Pluss og dokumentpipeline".
It is exported here so that scripts/check-citations.js can resolve the v3
citations in the code against real headings — before this file existed they
matched no pattern and nothing verified them.

Two consequences worth knowing. The copy can drift from the note, and nothing
detects that: re-export by hand after editing the note. And the section
numbering is its own, independent of v2 — v3 §3 is the search-first funnel,
v2 §3 is the trust contract. That is why the two are separate files with
separate citation forms rather than one merged pool.
-->

# Luma Anbudsvarsling IDE Agent Spec v3: Søk-først, Pluss og dokumentpipeline

| Felt | Verdi |
| --- | --- |
| Dokumentstatus | Implementasjonsspesifikasjon for Claude Code |
| Forhold til andre dokumenter | Supplerer IDE Agent Specification v2 og Tjenestemodell-spec. Bygger på «Search-first onboarding — direction and plan» i repoet og løser de åpne punktene derfra. Ved konflikt gjelder dette dokumentet. |
| Kundespråk | Norsk bokmål |
| Teknisk språk | Engelsk |
| Betalingsmodell | Manuell faktura. Ingen faktureringsmotor bygges. |

---

## 0. Endringslogg og beslutninger som ligger fast

Dette dokumentet spesifiserer alt som er besluttet etter tjenestemodell-spec-en:

1. Formålshierarkiet er presisert og styrer all prioritering (seksjon 1).
2. Doffin-lisensspørsmålet er avklart: kunngjøringsdata er åpne data under CC BY 4.0. Lanseringsblokkering 9 i v2 kan lukkes (seksjon 2).
3. Onboarding legges om fra registrer-først til søk-først, med offentlig, indekserbar søkeflate (seksjon 3).
4. Betalt nivå innføres: **Anbudsvarsling Pluss**, eget produkt med egen fakturakode (seksjon 4).
5. Dokumentpipeline: henting, lagring, visning og sletting av konkurransegrunnlag (seksjon 5 og 6).
6. MCP deles i fri og betalt scope. Hele serveren forblir gratis; dokumentverktøyene krever Pluss (seksjon 7).
7. Skills er en navngitt retning med pilotplan, ikke et byggeoppdrag (seksjon 8).
8. Påfyll berøres ikke av dette dokumentet. Påfyll og Pluss er to adskilte inntektsstrømmer som aldri bundles, og omtales hver for seg i promoteringstrappen.

---

## 1. Formålshierarki og styringsregler

Tjenestens formål, i rekkefølge:

1. **Primært:** skape en meningsfull forbindelse mellom brukerne og kurset «Vinn flere anbud med AI».
2. **Sekundært:** en liten abonnementsinntekt på toppen av gratistjenesten, som gir mening og oppleves rettferdig.

Styringsregler som følger av hierarkiet:

- Kursattribusjon rapporteres først. Påfyll- og Pluss-inntekt rapporteres separat, aldri samlet.
- Ingen abonnementsfunksjon prioriteres foran en funksjon som styrker kursforbindelsen. Når et veivalg hjelper abonnement uten å berøre kursstien, venter det.
- Gratistjenesten mister aldri noe den har i dag. Betalt nivå selger arbeid (henting, lagring, uttrekk), aldri data.
- Tillitskontrakten i v2 seksjon 3 gjelder uendret for alt i dette dokumentet.

---

## 2. Juridisk avklaring: Doffin-data

Avklart ved undersøkelse (dokumenteres som ADR med kildene):

- DFØ publiserer Doffin-kunngjøringsdata som registrert åpent datasett på data.norge.no under **CC BY 4.0**, med årlige CSV-dumper og et offentlig API for egne spørringer. Åpenheten er del av Norges OGP-forpliktelse 2023–2027.
- **Krav som følger:** kildeangivelse «Data: Doffin/DFØ (CC BY 4.0)» på anbudssider, i delt-visning, i offentlige søkesider og i rapporter. Data skal ikke fremstilles villedende eller som om DFØ har godkjent tjenesten. v2-regelen om å ikke etterligne Doffin visuelt består.
- **Grensen:** lisensen dekker strukturerte kunngjøringsdata. Den dekker ikke konkurransegrunnlagsdokumentene, som er forfattet av oppdragsgivere og ligger i KGV-systemene. Derav regelen i seksjon 5: kunngjøringsdata kan være offentlige sider; dokumenter er alltid brukerscopet.

Oppgave: lukk lanseringsblokkering 9 i v2 med et kort notat som siterer datasettregistreringen, og opprett ADR-18 (Doffin-lisens og attribusjon).

---

## 3. Søk-først onboarding

Retningsdokumentet i repoet gjelder som implementasjonsgrunnlag. Dette avsnittet fastsetter beslutningene som var åpne der.

### 3.1 Fase A: Inngangsdøren (uendret fra retningsdokumentet, pluss to tillegg)

Lever som spesifisert: `pending_signups` (migrasjon 0005), `registration.ts` med begge-grener-sender-e-post, konsumering i transaksjon, uttrekkene `profile-write.ts` og `client-identity.ts`, landingsskjema koblet.

Tillegg besluttet i gjennomgangen:

1. **Cleanup-jobb:** `signup.cleanup` sletter utløpte, ukonsumerte `pending_signups`-rader (speiler `share.cleanup`). Utløpte rader er persondata uten behandlingsgrunnlag.
2. **Ikke-enumererings-kommentar:** ved responsteksten i `registration.ts` skal det stå en kodekommentar som forklarer hvorfor kjent og ukjent adresse aldri må gi ulik respons, slik at integrasjonstesten som håndhever det er selvforklarende når den feiler.
3. Merk i `launch-readiness.md`: brukere vervet i fase A aksepterer placeholder-vilkår. Reell vilkårstekst må re-aksepteres ved innlogging når den foreligger; bygg re-akseptflyten samtidig med vilkårene.

### 3.2 Fase B: Anonym søkeflate, med regiondimensjon

- `draft-profile.ts` som spesifisert, validert mot `alertProfileSchema` i test.
- **Regionbeslutningen:** kjør tetthetsspørringen først: antall kunngjøringer per tjenestemal per landsdel siste 90 dager. Tjenestemal × landsdel-kombinasjoner som bærer en side (veiledende terskel: minst 8 aktive treff i vinduet) får statisk side `/anbud-for/[bransje]/[landsdel]`. Kombinasjoner under terskelen kollapser til nasjonal side. Nasjonale sider for cross_sector-maler skal ha regionvelger synlig over resultatene, slik at bredden leses som standardvalg og ikke som feiltreff. Tersklene og resultatet av spørringen dokumenteres i spec-deviations.
- `generateStaticParams()` over de kvalifiserte kombinasjonene + `revalidate = 3600`. Aldri `force-dynamic` på offentlige sider.
- **Instrumentering skjer i fase B, ikke i fase D:** eventene `picker_viewed`, `trade_selected`, `region_selected`, `results_viewed`, `signup_started`, `signup_completed`, `profile_activated`, alle med tjenestemal-slug. `retur`-slug bæres gjennom hele registreringen. Skriv ned baseline-forventningen før fase B deployes (dagens skjema konverterer 0; sammenlign søk-først mot fungerende enkelt skjema fra fase A).
- Paused-on-create beholdes ved lansering; revurderes mot funnel-data.

### 3.3 Fase C: Offentlige detaljsider og SEO (avblokkert av seksjon 2)

- `public-tenders.ts` med **eksplisitt `suppressedAt`-filter**; `assertTenderAccess` forbigås her by design, så undertrykkelsen må håndheves på nytt i den offentlige lesestien.
- Caching: on-demand revalidation fra ingest-workeren. Synkjobben vet hvilke tenders som endret seg; den kaller revalidate for de berørte `/kunngjoring/[id]`-sidene. Ikke `generateStaticParams` over korpuset.
- **Noindex ved statusflipp:** siden selv skal emitte noindex når status blir closed/cancelled/awarded, i tillegg til at sitemap kun lister open og planned. Google har allerede hentet sidene; sitemap-eksklusjon alene er ikke nok.
- `sitemap.ts`, `X-Robots-Tag: noindex` på app-sidene per retningsdokumentet, og robots.txt-bestillingen til marketing-repoet flagges nå (ledetid).
- CC BY-attribusjonslinjen på alle offentlige anbudssider.

---

## 4. Anbudsvarsling Pluss

### 4.1 Produktdefinisjon

Eget betalt nivå med egen identitet. Arbeidsnavn: **Anbudsvarsling Pluss**. Egen produktkode i bestillingsflyten (`pluss`), eget entitlement, egen linje i attribusjonsrapporten.

Innhold ved lansering:

1. Dokumenthenting: konkurransegrunnlaget hentes og normaliseres for anbud brukeren ber om det på.
2. Dokumentlesing i dashbord (manifest, nedlasting, zip) og gjennom MCP (seksjon 7).
3. Dokumenter beholdes på lagrede anbud, også etter at konkurransen er utløpt (seksjon 6 styrer sletting).
4. Fase 8-funksjonene (tildelingsovervåking, rammeavtaleutløp) legges i Pluss når de bygges.

Rettferdighetshistorien, som skal stå i produktteksten: du betaler for arbeid som koster noe (henting, lagring, uttrekk), aldri for data. Gratistjenesten mister ingenting.

### 4.2 Pris og fakturering

- Liten, årlig pris i samme psykologiske nabolag som Påfyll. Endelig pris settes av produkteier; implementasjonen hardkoder ingen pris.
- Manuell faktura via eksisterende `OrderRequest`-flyt. Ingen faktureringsmotor, ingen abonnementsmotor. Fornyelse håndteres manuelt med en admin-påminnelse (enkel rapport over entitlements som utløper innen 60 dager).
- Entitlement-modell: `user_entitlements` (userId, productCode, grantedAt, expiresAt, grantedByAdminId, orderRequestId). Kurskjøp kan gi entitlement på samme mekanisme senere; ikke implementer koblingen nå.

### 4.3 Oppgraderingsgrensen

Når en gratisbruker (web eller MCP) treffer en Pluss-funksjon:

- Svaret er ett kort, ærlig avslag med lenke: «Dette krever Anbudsvarsling Pluss.» I MCP returneres det i verktøykanalen som strukturert feil med `upgrade_url`, aldri som markedsføringstekst i dataresultater.
- Påfyll nevnes aldri i oppgraderingssvar. Kryssalg mellom strømmene skjer kun i promoteringstrappen i digest-footeren, der Pluss får egen blokk ved siden av Påfyll-blokken, hver tydelig seg selv.
- Avslaget vises én gang per kontekst, uten mas.

---

## 5. Dokumentpipeline

### 5.1 Kilde: documentsUrl fra kunngjøringen

- Normaliseringen løfter dokumentlenken til `Tender.documentsUrl`: eForms-feltet BT-15 (Documents URL, per Lot/Part) for nye kunngjøringer; tekstmønsteret «Konkurransegrunnlaget er elektronisk tilgjengelig … på: [URL]» for historiske. Tom verdi er gyldig tilstand («Oppdragsgiver har ikke lastet opp dokumenter») og vises ærlig.

### 5.2 Adaptere

```typescript
interface DocumentSourceAdapter {
  canHandle(url: string): boolean;
  resolve(url: string): Promise<DocumentManifest>;   // filliste: navn, størrelse, type, fetchUrl
  fetch(entry: ManifestEntry): Promise<ReadableStream>;
}
```

Implementasjoner, i prioritert rekkefølge (Mercell-konsolideringen gjør at tre familier dekker det meste av markedet):

1. `TendSignAdapter` (tendsign.no/doc.aspx-mønsteret; enklest, bygges først)
2. `MercellAdapter` (offentlig nedlastingsflyt uten innlogging; sesjonsbasert HTTP + HTML-parsing; håndter både «Filer» og «Systemgenererte filer»)
3. `CtmAdapter` (Mercell CTM / ex EU-Supply, inkl. kgv.doffin.no/ctm; «se anonymt»-lenken)
4. `GenericHttpAdapter` (direktelenker og oppdragsgivers egne nettsider)
5. Fallback: status `unsupported` → dyplenke + per-system instruksjoner til brukeren. Ærlig avslag, aldri stille feil.

Driftsregler: identifiserende User-Agent, rate limiting per vertshost, exponential backoff, henting utløses kun av brukerhandling. Playwright er siste utvei for flyter som motstår ren HTTP, aldri default. Fixture-innspilte HTML-flyter i tester; CI avhenger aldri av KGV-enes oppetid. Daglig canary som resolver én kjent URL per adapterfamilie og varsler ved brudd; per-adapter suksessrate på admin-dashbordet.

### 5.3 Lagring

- S3-kompatibel objektlagring, anbefalt Cloudflare R2 (gratis egress teller for zip-nedlastinger). Nøkkel: `{contentHash}/{filename}`, innholdsadressert, dedupliseres automatisk på tvers av brukere.
- Tabeller: `tender_documents` (tenderId, filename, mime, size, contentHash, storageKey, sourceUrl, status: pending/fetched/failed/unsupported/requires_manual, fetchedAt, version) og `tender_document_requests` (userId, tenderId, requestedAt) som bærer brukerrelasjonen og referansetellingen.
- Versjonering: når endringsdeteksjonen melder revisjon på et anbud med hentede dokumenter, re-resolves manifestet og endrede filer hentes som ny versjon. Begge versjoner beholdes så lenge referansen lever.

### 5.4 Servering (direkte filtilgang)

- `/api/v1/tenders/:id/documents` (manifest), `/api/v1/tenders/:id/documents/:docId/download` (kortlevd signert R2-URL), `/api/v1/tenders/:id/documents/zip`. Alt bak Pluss-entitlement, alt audit-logget.
- Juridiske egenskaper som kodekrav: brukerscopet tilgang, ingen offentlig listing, ingen indeksering (ingenting serveres uautentisert), § 7-4-begrensede konkurranser får `requires_manual` med dyplenke.

---

## 6. Retensjon og sletting

Referansetellet sletting; «utdatert» og «slettbar» er ulike mengder fordi arkivet på lagrede anbud er Pluss-produktet.

En blob er slettbar når ingen levende referanse peker på den. Referanser dør slik:

1. Anbudet er closed/cancelled/awarded + 30 dagers frist, og ingen Pluss-bruker har det lagret.
2. Brukeren fjerner lagringen, eller sletter kontoen (eksisterende GDPR-slettejobb utvides til dokumentreferanser).
3. Admin undertrykker anbudet → kaskade til umiddelbar sletting av blober og tekstuttrekk.

Implementasjon: nattlig `documents.cleanup` (speiler `share.cleanup`): gå gjennom utløpte referanser, dekrementer, slett foreldreløse blober + tilhørende `tender_document_texts`.

Tillegg:

- **Takedown-bryter** i admin per oppdragsgiver og per dokument: umiddelbar sletting + blokkering av re-henting. Skal finnes fra første dag pipelinen er i drift.
- **Vilkårs- og personverntekst:** «Dokumenter lagres så lenge du følger anbudet, og slettes senest 30 dager etter at konkurransen er avsluttet, med mindre du har dem lagret med Anbudsvarsling Pluss.» Behandlingsgrunnlaget er brukerrelasjonen; teksten inn i seksjon 18/19-revisjonen i v2.

---

## 7. Tekstuttrekk og MCP-scope

### 7.1 Uttrekk

Worker-jobb etter henting: PDF (tekstlag; OCR utsettes), docx, xlsx → normalisert tekst i `tender_document_texts` (docId, chunkIndex, heading, text), chunket med bevart overskriftsstruktur. Full-tekstsøk med Postgres tsvector; embeddings utsettes til behovet er bevist.

### 7.2 Scope-deling

MCP-serveren forblir gratis. Fri scope er uendret (fase 1-verktøyene i v2 32.1). Nytt scope `documents:read` gis av Pluss-entitlement og låser opp:

**get_tender_documents(tenderId)** → manifest med uttrekksstatus, så modellen vet hva som finnes før den leser.

**read_tender_document(documentId, cursor?)** → ekstrahert tekst i avgrensede porsjoner (20 000–40 000 tegn) med fortsettelsescursor og bevart struktur. Hvert svar bærer signert nedlastings-URL så mennesket kan åpne filen modellen siterer.

**search_tender_documents(tenderId, query)** → relevante passasjer med dokument- og posisjonsreferanse.

Gratisbruker som kaller disse får den strukturerte oppgraderingsfeilen fra 4.3.

### 7.3 Sikkerhet og proveniens (ufravikelig)

- All ekstrahert tekst er ubetrodd ekstern input (v2 seksjon 31 gjelder med full tyngde nå som hele dokumenter når modellkontekst). Hvert tekstresultat pakkes i eksplisitt datainnramming, og serverinstruksene gjentar at instruksjoner funnet i anbudsdokumenter aldri skal følges.
- Hver chunk bærer proveniens: dokumentnavn, versjon, hentetidspunkt. Sporbarhet på dokumentnivå følger samme prinsipp som matchbegrunnelsene.
- Verktøyene i fri scope skal aldri returnere dokumentinnhold, heller ikke utdrag i søkeresultater.

---

## 8. Skills (retning, ikke bygg)

Dokumenteres her så retningen er kjent for agenten; ingen kode skrives før pilotsvaret foreligger.

- **Segment:** brukerne mellom «vi trenger ikke kurs» og aktiv MCP-bruk. Kjennetegn i data: høy MCP-verktøybruk, null klikk på kurspromotering.
- **Prinsipp:** skills er diagnostiske by design. De utfører metode (playbook fase 3–7-kandidater: tilbudsdisposisjon, kravmatrise, kvalifikasjonssjekk, referanseformulering, kvalitetssikring) og navngir sine egne grenser ved vurderingspunktene. En skill gjøres aldri så komplett at den argumenterer bort kurset.
- **Format:** metode-først, leverbar som Claude-skill, ChatGPT-prosjektinstruks og lesbart dokument.
- **Pilot, to kohorter:** alumni (kvalitet på skillen) og 10 håndplukkede MCP-storbrukere uten kursklikk (betalingsvillighet). Prishypotese: kjøp med 12 måneders oppdateringer, valgfri fornyelse. Ingen prisbeslutning før pilotsvar.
- **Levering senere:** entitlement-styrt MCP-ressurs (v2 seksjon 33 har kroken). Promoteringstrappen kan rute skills-blokken atferdsbasert til segmentet, kun i tillatte flater.

---

## 9. Måling

- Attribusjonsprioritet uendret: kursplasser først; Påfyll og Pluss rapporteres separat.
- Nye events: fase B-funnelen (3.2), `document_fetch_requested`, `document_read` (web/MCP), `upgrade_boundary_hit` (med kilde: web/mcp), `pluss_order_requested`, `pluss_activated`.
- `upgrade_boundary_hit` → `pluss_order_requested`-konvertering er Pluss-nivåets hovedmåltall.
- Attribusjonsdata forblir isolert fra matching (v2 ADR 6 gjelder).

---

## 10. Endringer mot v2 og nye ADR-er

| v2-seksjon | Endring |
| --- | --- |
| 7 (Omfang) | Søk-først-flatene og Pluss inn i omfang; fase 7 «fullt faktureringssystem» utgår (erstattet av entitlements + manuell flyt). |
| 9 (Brukerreiser) | Registreringsreisen erstattes av søk-først-funnelen; 9.6 består med `pluss` som produktkode. |
| 16 (Web) | Nye offentlige ruter: /finn-anbud, /anbud-for/[bransje](/[landsdel]), /kunngjoring/[id], /registrering/sjekk-e-post. |
| 19 (Vilkår) | Retensjonstekst (seksjon 6) og CC BY-attribusjon inn. |
| 30 (MCP-auth) | Nytt scope documents:read, entitlement-styrt. |
| 32 (MCP-verktøy) | Dokumentverktøyene inn som Pluss-scope; fri flate uendret. |
| 48 (Miljøvariabler) | + R2_* (bucket, credentials), DOCUMENT_FETCH_USER_AGENT, DOCUMENT_RETENTION_DAYS=30. |
| 50/51 | Nye blokkeringer/kriterier: attribusjonslinje synlig; delt-/offentlige sider lekker ikke; suppressedAt håndheves i offentlig lesesti; takedown-bryter finnes; oppgraderingsgrense fungerer i MCP. |

Nye ADR-er: 18 Doffin-lisens og attribusjon (CC BY 4.0; kunngjøringsdata offentlig, dokumenter brukerscopet). 19 Søk-først-funnel med statisk region-dimensjon besluttet av tetthetsdata. 20 Scope-delt MCP: fri oppdagelse, betalt dybde; oppgradering i verktøykanal. 21 Referansetellet dokumentretensjon med takedown. 22 Entitlements med manuell faktura; ingen faktureringsmotor. 23 Skills som diagnostisk produktretning; ingen bygging før pilot.

---

## 11. Rekkefølge

1. **Fase A** (inngangsdøren): som retningsdokumentet + signup.cleanup + kommentaren. Skipper alene.
2. **Fase B** (anonym flate): tetthetsspørringen først, deretter sidene, med events og retur-slug fra dag én.
3. **Fase C** (offentlige detaljsider + SEO): attribusjonslinje, revalidation fra worker, noindex-flipp, robots.txt-bestillingen.
4. **Fase D** (Pluss): entitlements + bestillingskode → TendSignAdapter → lagring/servering → cleanup + takedown → uttrekk → MCP-scope → øvrige adaptere. Canary og admin-dashbord før første betalende kunde.
5. **Parallelt, utenfor kode:** skills-piloten.

Hver fase ender i fungerende programvare. Fase D lanseres kontrollert mot et lite antall inviterte Pluss-kunder før åpen bestilling.

---

## 12. Akseptansekriterier

1. En anonym besøkende kan velge tjenestemal, se ekte treff, registrere seg, og hele kjeden er attribuert med tjenestemal-slug.
2. Kjent og ukjent e-postadresse gir identisk registreringsrespons i tekst, form og tid.
3. Offentlige sider bærer CC BY-attribusjon, håndhever suppressedAt, og flipper til noindex når konkurransen lukkes.
4. En Pluss-bruker kan hente konkurransegrunnlaget for et lagret anbud fra minst TendSign og Mercell, laste ned enkeltfiler og zip, og lese dokumentene gjennom MCP i porsjoner med proveniens.
5. En gratisbruker som kaller read_tender_document får det strukturerte Pluss-avslaget, uten dokumentinnhold og uten omtale av Påfyll.
6. Dokumenter på et ulagret anbud slettes automatisk 30 dager etter at konkurransen er avsluttet; takedown-bryteren sletter umiddelbart.
7. En § 7-4-begrenset konkurranse gir requires_manual med dyplenke, aldri en feilet jobb i stillhet.
8. Instruksjonstekst plantet i et hentet dokument gjengis som data og påvirker aldri verktøyenes oppførsel (test med forgiftet fixture).
9. Ingen faktureringsmotor finnes; Pluss aktiveres og utløper via entitlements med manuell adminflyt, alt logget.
