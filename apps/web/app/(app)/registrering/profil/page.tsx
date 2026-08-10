import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Button, Card, Checkbox, chipClassName, Stack } from '@luma/ui';
import { COUNTY_NAMES, cpvLabel, MARKETING_CONSENT_TEXT_NB } from '@luma/domain';
import {
  activateProfileAction,
  removeProfileCriterionAction,
} from '@/server/actions/onboarding-actions';
import { withMessage } from '@/server/actions/messages';
import { getWebDb } from '@/server/db';
import { safeDraftReturnPath } from '@/server/draft-profile';
import { NATIONWIDE_NB } from '@/server/format';
import { loadProfile, previewMatches } from '@/server/profiles';
import { requireUser } from '@/server/session';

export const metadata: Metadata = {
  title: 'Stemmer dette?',
  // The URL carries a profile id. Nothing here is worth indexing, and a crawler
  // following it would only ever see the login screen anyway.
  robots: { index: false, follow: false },
};

/**
 * Step three of the search-first signup: «Stemmer dette?» (design B5).
 *
 * ## Why this step is after the account, not before it
 *
 * `confirmSignup` creates the user, the terms acceptance, the consent mirror
 * and the profile in one transaction during the GET that redeems the emailed
 * link, and it creates the profile **paused** on purpose (spec section 3.2).
 * There is no earlier moment at which a review screen could exist: before that
 * transaction there is no session, no profile and nothing to show. So this page
 * is not "confirm before we build it" — it is "here is what we built from your
 * choices, take out what does not fit, then switch it on".
 *
 * That also makes the page the only place a paused profile normally becomes an
 * active one during onboarding, which is why the activate button is the loudest
 * thing on it.
 *
 * ## Why it lives under `(app)`
 *
 * The `(app)` layout resolves the session and redirects to `/logg-inn` when
 * there is none, and by the time the confirmation redirect lands here the
 * cookie is set. Putting the page in its own route group would mean a second
 * copy of the authentication boundary for one screen — a second place to get it
 * wrong — so it inherits this one, `NavTabs` and all. The tabs are truthful:
 * the account exists, and those pages work. The card below is what the eye
 * lands on.
 *
 * ## Without JavaScript
 *
 * Every chip is a `<button type="submit">` in its own one-field `<form>`, and
 * activation is a plain form post. There is no client component on this page,
 * so removing a chip is a round trip and the page comes back with the chip
 * gone. That is the same bargain every other form in this app makes.
 */

export const dynamic = 'force-dynamic';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * How many preview titles the design shows under the count.
 *
 * The *count* is not limited by this. `previewMatches` truncates its result
 * list to the limit it is given, so asking for three and then printing
 * `items.length` would print «3 treff» for a profile that matches ninety. The
 * preview is asked for everything it found and the titles are sliced here.
 */
const PREVIEW_TITLES_SHOWN = 3;
const ALL_PREVIEW_MATCHES = Number.MAX_SAFE_INTEGER;

interface PageProps {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** County codes as Norwegian names; an unrecognised code prints as itself. */
function describeArea(regionCodes: readonly string[]): string {
  if (regionCodes.length === 0) return NATIONWIDE_NB;
  return regionCodes.map((code) => COUNTY_NAMES[code] ?? code).join(', ');
}

export default async function Page({ searchParams }: PageProps) {
  const params = await searchParams;
  const user = await requireUser();

  const rawId = params['profil'];
  const profileId = typeof rawId === 'string' ? rawId : undefined;
  if (!profileId || !UUID_PATTERN.test(profileId)) {
    redirect(withMessage('/varsler', 'ukjent-profil'));
  }

  const db = getWebDb();
  // The id arrives in the URL, so it is attacker supplied. `loadProfile` scopes
  // by `userId` in the `where` — the same helper `(app)/varsler/[id]` uses —
  // so a profile belonging to somebody else is indistinguishable here from one
  // that does not exist.
  const profile = await loadProfile(db, { profileId, userId: user.id });
  if (!profile) redirect(withMessage('/varsler', 'ukjent-profil'));

  const rawReturn = params['retur'];
  const returnPath = safeDraftReturnPath(typeof rawReturn === 'string' ? rawReturn : undefined);

  const now = new Date();
  const preview = await previewMatches(db, { profile, now, limit: ALL_PREVIEW_MATCHES });
  const titles = preview.items.slice(0, PREVIEW_TITLES_SHOWN);

  const chipButtonClass = chipClassName({ tone: 'neutral', className: 'luma-chip--remove' });

  return (
    <div className="bleed">
      <div className="luma-panel">
        <Stack gap="lg" className="luma-column luma-column--wide">
          <div className="flex items-center gap-sm">
            {/* Two of three filled. Decoration only — «Siste steg» beside it is
                the accessible statement of where the reader is. */}
            <span aria-hidden="true" className="h-[6px] flex-1 rounded-full bg-brand" />
            <span aria-hidden="true" className="h-[6px] flex-1 rounded-full bg-brand" />
            <span aria-hidden="true" className="h-[6px] flex-1 rounded-full bg-line" />
            <span className="whitespace-nowrap text-sm font-semibold text-text-muted">
              Siste steg
            </span>
          </div>

          <Stack gap="sm">
            <h1 className="page-heading m-0">Stemmer dette?</h1>
            <p className="prose-measure m-0 text-text-muted">
              Vi har fylt ut profilen fra valgene dine. Fjern det som ikke passer.
            </p>
          </Stack>

          <Card tone="raised">
            <Stack gap="lg">
              <Stack gap="sm">
                <h2 className="m-0 text-base font-semibold">CPV-koder</h2>
                {profile.cpvInclude.length === 0 ? (
                  <p className="m-0 text-sm text-text-muted">
                    Ingen CPV-koder. Profilen bruker søkeordene og området nedenfor.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-xs">
                    {profile.cpvInclude.map((code) => (
                      <form key={code} action={removeProfileCriterionAction}>
                        <input type="hidden" name="profileId" value={profile.id} />
                        <input type="hidden" name="felt" value="cpv" />
                        <input type="hidden" name="verdi" value={code} />
                        {returnPath ? (
                          <input type="hidden" name="retur" value={returnPath} />
                        ) : null}
                        <button
                          type="submit"
                          className={chipButtonClass}
                          aria-label={`Fjern «${cpvLabel(code)}»`}
                        >
                          <span className="luma-chip__text">{cpvLabel(code)}</span>
                          <span aria-hidden="true" className="luma-chip__glyph">
                            ×
                          </span>
                        </button>
                      </form>
                    ))}
                  </div>
                )}
              </Stack>

              <Stack gap="sm" className="border-t border-line pt-lg">
                <h2 className="m-0 text-base font-semibold">Søkeord</h2>
                {profile.keywordsInclude.length === 0 ? (
                  <p className="m-0 text-sm text-text-muted">
                    Ingen søkeord. Profilen bruker CPV-kodene og området.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-xs">
                    {profile.keywordsInclude.map((keyword) => (
                      <form key={keyword} action={removeProfileCriterionAction}>
                        <input type="hidden" name="profileId" value={profile.id} />
                        <input type="hidden" name="felt" value="sokeord" />
                        <input type="hidden" name="verdi" value={keyword} />
                        {returnPath ? (
                          <input type="hidden" name="retur" value={returnPath} />
                        ) : null}
                        <button
                          type="submit"
                          className={chipButtonClass}
                          aria-label={`Fjern «${keyword}»`}
                        >
                          <span className="luma-chip__text">{keyword}</span>
                          <span aria-hidden="true" className="luma-chip__glyph">
                            ×
                          </span>
                        </button>
                      </form>
                    ))}
                  </div>
                )}
              </Stack>

              <Stack gap="sm" className="border-t border-line pt-lg">
                <h2 className="m-0 text-base font-semibold">Område</h2>
                <p className="m-0">{describeArea(profile.regionsInclude)}</p>
                <p className="m-0 text-sm text-text-muted">
                  Området endrer du fra varslingsprofilen etter at du har startet den.
                </p>
              </Stack>

              <Stack gap="sm" className="border-t border-line pt-lg">
                {/*
                  The design writes «siste 30 dager». The preview actually looks
                  `PREVIEW_WINDOW_DAYS` back, which is 60, so the number comes
                  from the result rather than from the mockup — a count over
                  sixty days presented as thirty would overstate the profile by
                  a factor the reader has no way to see.
                */}
                <h2 className="m-0 text-base font-semibold">
                  {preview.items.length === 0
                    ? `Profilen traff ingen kunngjøringer de siste ${preview.windowDays} dagene`
                    : `Med denne profilen ville du fått ${preview.items.length} treff siste ${preview.windowDays} dager`}
                </h2>
                {preview.items.length === 0 ? (
                  <p className="prose-measure m-0 text-sm text-text-muted">
                    Det kan bety at profilen er for smal, eller rett og slett at det ikke ble
                    publisert noe relevant i perioden. Start den likevel — du kan justere kriteriene
                    fra varslingsprofilen når som helst.
                  </p>
                ) : (
                  <ul className="m-0 list-none p-0">
                    {titles.map((item) => (
                      <li key={item.tenderId} className="text-sm text-text-muted">
                        — {item.title}
                      </li>
                    ))}
                  </ul>
                )}
              </Stack>

              <form action={activateProfileAction}>
                <input type="hidden" name="profileId" value={profile.id} />
                {returnPath ? <input type="hidden" name="retur" value={returnPath} /> : null}
                <Stack gap="md" className="border-t border-line pt-lg">
                  {/*
                    The design puts a required «Jeg godtar vilkårene» box here.
                    It is not rendered, because it would have nothing to write:
                    the acceptance was recorded inside `confirmSignup`'s
                    transaction, with its version, timestamp and IP hash, before
                    this page could exist. A second box would be either a
                    duplicate legal record or a decoration — so the fact is
                    stated instead of re-collected.
                  */}
                  <p className="prose-measure m-0 text-sm text-text-muted">
                    Du godtok <Link href="/vilkar">bruksvilkårene</Link> da du bekreftet
                    e-postadressen. <Link href="/personvern">Personvernerklæringen</Link> forklarer
                    hva vi lagrer.
                  </p>

                  <Checkbox name="markedsforing" label={MARKETING_CONSENT_TEXT_NB} />

                  <Checkbox
                    name="faglig-pafyll"
                    // Checked by default because that is the stored default
                    // (`include_luma_promotions_in_tender_emails` is `true`), and
                    // a box that starts unticked while the setting is on would
                    // misreport the service to the person switching it on.
                    defaultChecked
                    label={
                      <>
                        Vis faglig påfyll fra Luma Training nederst i varslene.{' '}
                        <span className="text-text-muted">
                          Dette er hvordan tjenesten finansieres. Du kan slå det av når som helst.
                        </span>
                      </>
                    }
                  />

                  <div>
                    <Button type="submit" variant="primary">
                      Start varslingen
                    </Button>
                  </div>
                  <p className="m-0 text-sm text-text-muted">
                    Profilen står på pause til du starter den. Da kommer det første varselet i
                    morgen tidlig.
                  </p>
                </Stack>
              </form>
            </Stack>
          </Card>
        </Stack>
      </div>
    </div>
  );
}
