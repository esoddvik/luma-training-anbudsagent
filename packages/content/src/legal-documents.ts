import { legalDocumentKindSchema, type LegalDocumentKind } from '@luma/domain';
import { z } from 'zod';

/**
 * Legal documents as committed content (spec section 19, ADR-11).
 *
 * ## Why the text lives here rather than in the page
 *
 * `/vilkar` used to render this prose inline and stamp a `TERMS_VERSION`
 * constant from `apps/web/src/lib/legal.ts`, while `legal_document_versions`
 * held a separate row that nothing kept in step. A user could accept version X
 * while reading the text of version Y and nothing would detect it. One source
 * now: this file is rendered by the page, seeded into the table, and copied
 * into `consent_text_versions` when somebody accepts.
 *
 * ## What engineering may and may not do with this file
 *
 * Section 19 says the final terms are not published without review, and
 * `docs/launch-readiness.md` blocker 2 says engineering must not write them.
 * The *mechanism* is engineering's; the *text* is Luma's. `isPlaceholder`
 * carries the difference: it stays true until Luma supplies reviewed text
 * under a new version, and section 51 item 8 blocks launch while any document
 * in force is a placeholder.
 *
 * ## Versions are append-only
 *
 * Publishing new terms means **adding** an entry, never editing one. An
 * acceptance carries a foreign key onto `(kind, version)`, so editing a
 * published body rewrites what people already agreed to. The sync in
 * `apps/web/src/server/legal-documents.ts` refuses it rather than applying it.
 */

export const legalDocumentSeedSchema = z.object({
  kind: legalDocumentKindSchema,
  /** Free-form, but sorts and reads as a date. Unique per kind. */
  version: z.string().min(1),
  /** Norwegian bokmål. Markdown. */
  body: z.string().min(1),
  /** True while the text is a draft rather than reviewed legal copy. */
  isPlaceholder: z.boolean(),
  effectiveFrom: z.date(),
});

export type LegalDocumentSeed = z.infer<typeof legalDocumentSeedSchema>;

/**
 * The placeholder terms.
 *
 * Moved verbatim from the prose that `apps/web/app/(public)/vilkar/page.tsx`
 * rendered inline, keeping the version string it was already stamped with so
 * that acceptances recorded before this refactor still name the same document.
 *
 * IMPORTANT — this is a draft. It must not be presented as finished terms, and
 * `isPlaceholder` below is what stops that: section 51 item 8 keeps launch
 * blocked while it is true.
 */
const TERMS_PLACEHOLDER_BODY = `## Om tjenesten

Luma Anbudsvarsling er en gratis tjeneste fra Luma Training som varsler om
kunngjøringer og planlagte anskaffelser publisert på Doffin. Tjenesten er et
hjelpemiddel i tilbudsarbeidet, ikke en erstatning for oppdragsgivers egne
kanaler.

## Ditt ansvar

Du er selv ansvarlig for å følge fristene og kravene i den enkelte
konkurransen. Luma Training svarer ikke for tapte muligheter, forsinkede
varsler eller feil i data hentet fra Doffin.

## Rangering og markedsføring

Kommersielle hensyn påvirker aldri hvilke anbud som rangeres høyest.

## Personopplysninger

Behandling av personopplysninger er beskrevet i Luma Trainings
personvernerklæring. Du kan slette kontoen din når som helst.

Dette er et utkast. Endelige vilkår godkjennes og versjonslagres før tjenesten
åpnes for publikum.`;

export const LEGAL_DOCUMENT_SEEDS: readonly LegalDocumentSeed[] = [
  {
    kind: 'terms',
    version: '2026-01-utkast',
    body: TERMS_PLACEHOLDER_BODY,
    isPlaceholder: true,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
  },
] as const;

/**
 * The document of a kind that is in force: the one with the newest
 * `effectiveFrom`.
 *
 * The same rule the database reads by, so the page and the table cannot
 * disagree about which version a user is looking at.
 */
export function currentLegalDocumentSeed(
  kind: LegalDocumentKind,
  seeds: readonly LegalDocumentSeed[] = LEGAL_DOCUMENT_SEEDS,
): LegalDocumentSeed | undefined {
  return seeds
    .filter((seed) => seed.kind === kind)
    .sort((a, b) => b.effectiveFrom.getTime() - a.effectiveFrom.getTime())[0];
}
