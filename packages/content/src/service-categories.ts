import { z } from 'zod';

/**
 * The service categories (ADR-17 consequence 3).
 *
 * A flat editorial list, deliberately not a hierarchy. It is the *only*
 * segmentation key in the product: all analysis, reporting and promotion
 * routing group on the category a user declared. Never on NACE, never on award
 * history, never on the buyer's sector.
 *
 * The keys are seeded from CPV divisions, because that is where the market
 * actually splits, but they are named the way a Norwegian supplier introduces
 * itself. «Vi driver med renhold» is a category; "90910000 — Cleaning
 * services" is a CPV code, and a supplier asked to pick one of those will pick
 * wrongly or give up. The division shown against each entry below is the
 * provenance, not a filter — a category is not a CPV query and must never be
 * turned into one.
 *
 * **A key is stable forever.** Categories may be added; a key may never be
 * renamed. Every count, trend and demand map in the product is grouped by
 * these strings, so renaming one silently rebases its whole time series — the
 * old series ends, a new one starts, and nothing anywhere says a break
 * happened. `service-categories.test.ts` pins the current set so a rename
 * fails the build instead.
 *
 * IMPORTANT — like the template seeds, this is a considered starting point and
 * **requires Luma's review before launch** (spec §11.2). The CPV divisions are
 * real; whether the Norwegian labels are the words suppliers use, and whether
 * the cuts fall in the right places, is an editorial judgement only Luma can
 * make. Unlike the templates, this list is *not* editable in admin without a
 * deploy, precisely because the keys must not move.
 *
 * Two entries name services that public bodies are themselves best known for
 * — training and care. That is deliberate and it is not a
 * contradiction of ADR-17: a private course provider genuinely delivers
 * training, and refusing it a category would force it to declare something
 * false. What ADR-17 forbids is the *inverse* — reading a buyer-sector CPV
 * division (75, 80, 85) as if it described the supplier. A category is a
 * self-declaration; a CPV division on a template is an assumption. The
 * templates carry no such division, and
 * `no-buyer-side-assumptions.test.ts` is what keeps that true.
 */

export const serviceCategorySchema = z.object({
  /** Stable machine key. Never renamed — see the module comment. */
  key: z.string().regex(/^[a-z0-9-]+$/),
  /** Norwegian label, as a supplier would describe itself. */
  label: z.string().min(1),
  /** Where the cut comes from, for the editor reviewing this list. */
  cpvProvenance: z.string().min(1),
});

export type ServiceCategory = z.infer<typeof serviceCategorySchema>;

export const SERVICE_CATEGORIES: readonly ServiceCategory[] = [
  {
    key: 'bygg-og-anlegg',
    label: 'Bygg og anlegg',
    cpvProvenance: 'CPV 45 — bygge- og anleggsarbeid',
  },
  {
    key: 'prosjektering-og-radgivning',
    label: 'Prosjektering og rådgivning',
    cpvProvenance: 'CPV 71 — arkitekt-, ingeniør- og kontrolltjenester',
  },
  {
    key: 'tekniske-installasjoner',
    label: 'Tekniske installasjoner',
    cpvProvenance: 'CPV 45.3 og 51 — installasjonsarbeid og installasjonstjenester',
  },
  {
    key: 'drift-og-vedlikehold-av-eiendom',
    label: 'Drift og vedlikehold av eiendom',
    cpvProvenance: 'CPV 50 og 79993 — reparasjon, vedlikehold og eiendomsforvaltning',
  },
  {
    key: 'renhold-og-facility-management',
    label: 'Renhold og facility management',
    cpvProvenance: 'CPV 90.9 — renholds- og sanitærtjenester',
  },
  {
    key: 'avfall-og-gjenvinning',
    label: 'Avfall og gjenvinning',
    cpvProvenance: 'CPV 90.5 — avfallshåndtering',
  },
  {
    key: 'vann-og-avlop',
    label: 'Vann og avløp',
    cpvProvenance: 'CPV 41 og 45.23 — vannforsyning og ledningsanlegg',
  },
  {
    key: 'energi-og-kraft',
    label: 'Energi og kraft',
    cpvProvenance: 'CPV 09 og 71.31 — energiprodukter og energirådgivning',
  },
  {
    key: 'it-tjenester',
    label: 'IT-tjenester',
    cpvProvenance: 'CPV 72 og 48 — IT-tjenester og programvare',
  },
  {
    key: 'konsulentbistand-og-ledelse',
    label: 'Konsulentbistand og ledelse',
    cpvProvenance: 'CPV 79.4 — virksomhets- og ledelsesrådgivning',
  },
  {
    key: 'kommunikasjon-og-marked',
    label: 'Kommunikasjon og marked',
    cpvProvenance: 'CPV 79.3 og 79.34 — markedsundersøkelser og reklame',
  },
  {
    key: 'bemanning-og-rekruttering',
    label: 'Bemanning og rekruttering',
    cpvProvenance: 'CPV 79.6 — rekruttering og utleie av personell',
  },
  {
    key: 'vakthold-og-sikkerhet',
    label: 'Vakthold og sikkerhet',
    cpvProvenance: 'CPV 79.7 — etterforsknings- og sikkerhetstjenester',
  },
  {
    key: 'kantine-og-matservering',
    label: 'Kantine og matservering',
    cpvProvenance: 'CPV 55 — hotell-, restaurant- og kantinetjenester',
  },
  {
    key: 'transport-og-logistikk',
    label: 'Transport og logistikk',
    cpvProvenance: 'CPV 60 og 63 — transporttjenester og tilknyttede tjenester',
  },
  {
    key: 'kjoretoy-og-maskiner',
    label: 'Kjøretøy og maskiner',
    cpvProvenance: 'CPV 34 og 43 — transportmidler og anleggsmaskiner',
  },
  {
    key: 'moblering-og-inventar',
    label: 'Møblering og inventar',
    cpvProvenance: 'CPV 39 — møbler, inventar og husholdningsartikler',
  },
  {
    key: 'medisinsk-utstyr-og-forbruksmateriell',
    label: 'Medisinsk utstyr og forbruksmateriell',
    cpvProvenance: 'CPV 33 — medisinsk utstyr og legemidler',
  },
  {
    key: 'opplaering-og-kompetanse',
    label: 'Opplæring og kompetanse',
    cpvProvenance: 'CPV 80 — opplæringstjenester, som levert tjeneste',
  },
  {
    key: 'helse-og-omsorgstjenester',
    label: 'Helse- og omsorgstjenester',
    cpvProvenance: 'CPV 85 — helse- og sosialtjenester, som levert tjeneste',
  },
] as const;

/** The keys alone, for validating a declared category. */
export const SERVICE_CATEGORY_KEYS: readonly string[] = SERVICE_CATEGORIES.map(
  (category) => category.key,
);

export function findServiceCategory(key: string): ServiceCategory | undefined {
  return SERVICE_CATEGORIES.find((category) => category.key === key);
}
