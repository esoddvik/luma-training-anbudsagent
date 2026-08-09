import Link from 'next/link';
import { Stack } from '@luma/ui';
import { COUNTY_NAMES } from '@luma/domain';
import type { PublicSearchResult, PublicTenderSummary } from '@/server/public-search';
import { formatDate } from '@/server/format';

/**
 * Results on an anonymous search page (IDE Agent Spec v3, section 3.2).
 *
 * Two sections, never one merged list. The reason is measured rather than
 * aesthetic: for `it-tjenester-og-konsulentbistand`, 36 of its qualifying hits
 * are nationwide notices that appear on every landsdel page, so a merged list
 * would make its six regional pages ~86% identical — near-duplicate content
 * aimed at a search engine, and six URLs differing only in their heading.
 * Splitting them keeps each page's regional half genuinely its own while still
 * showing the reader every competition they can bid on.
 * See `docs/search-surface-density.md`.
 */

const LICENCE_URL = 'https://creativecommons.org/licenses/by/4.0/deed.no';

function TenderRow({ tender }: { tender: PublicTenderSummary }) {
  const counties = tender.regionCodes
    .map((code) => COUNTY_NAMES[code])
    .filter((name): name is string => Boolean(name));

  return (
    <li className="border-b border-border py-md last:border-0">
      <Stack gap="xs">
        <p className="m-0 font-medium">{tender.title}</p>
        <p className="m-0 text-sm text-text-muted">
          {tender.buyerName}
          {counties.length > 0 ? ` · ${counties.join(', ')}` : ''}
        </p>
        <p className="m-0 text-sm text-text-muted">
          {tender.noticeCategory === 'planned' ? (
            // Never a fabricated deadline. A planned procurement has none,
            // and saying so is the point of the category (ADR-13).
            <>Planlagt anskaffelse · konkurransen er ikke publisert ennå</>
          ) : (
            <>Frist {tender.deadlineAt ? formatDate(tender.deadlineAt) : 'ikke oppgitt'}</>
          )}
        </p>
      </Stack>
    </li>
  );
}

export function PublicResults({
  result,
  landsdelName,
}: {
  result: PublicSearchResult;
  landsdelName?: string;
}) {
  const nothing = result.regional.length === 0 && result.nationwide.length === 0;

  if (nothing) {
    return (
      <p className="m-0">
        Vi fant ingen aktive kunngjøringer for dette området de siste 90 dagene. Det betyr ikke at
        det ikke kommer noen — sett opp varsling, så sier vi fra når en dukker opp.
      </p>
    );
  }

  return (
    <Stack gap="xl">
      {result.regional.length > 0 ? (
        <section aria-labelledby="regionale-treff">
          <Stack gap="sm">
            <h2 id="regionale-treff" className="section-heading">
              {landsdelName ? `Kunngjøringer i ${landsdelName}` : 'Kunngjøringer'}
            </h2>
            <ul className="m-0 list-none p-0">
              {result.regional.map((tender) => (
                <TenderRow key={tender.id} tender={tender} />
              ))}
            </ul>
          </Stack>
        </section>
      ) : null}

      {result.nationwide.length > 0 ? (
        <section aria-labelledby="nasjonale-treff">
          <Stack gap="sm">
            <h2 id="nasjonale-treff" className="section-heading">
              Gjelder hele landet
            </h2>
            <p className="m-0 text-sm text-text-muted">
              Disse konkurransene er ikke knyttet til én landsdel, så de er like aktuelle her som
              andre steder.
            </p>
            <ul className="m-0 list-none p-0">
              {result.nationwide.map((tender) => (
                <TenderRow key={tender.id} tender={tender} />
              ))}
            </ul>
          </Stack>
        </section>
      ) : null}

      {/* Required by CC BY 4.0 on every surface that redistributes announcement
          data to someone who did not ask for it themselves (ADR-0018). */}
      <p className="m-0 text-sm text-text-muted">
        {/* Reads exactly `Data: Doffin/DFØ (CC BY 4.0)` as text, with the
            licence name carrying the link. ADR-0018 fixes the wording, so a
            test asserts the rendered text rather than this markup. */}
        Data: Doffin/DFØ (<Link href={LICENCE_URL}>CC BY 4.0</Link>)
      </p>
    </Stack>
  );
}
