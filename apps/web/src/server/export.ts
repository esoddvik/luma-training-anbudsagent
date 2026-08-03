import { and, eq, isNull } from 'drizzle-orm';
import * as schema from '@luma/db/schema';
import type { Database } from './db';

/**
 * The user's own data, for export (spec section 4.4: "Eksportere egne data").
 *
 * Two rules shape what is in here:
 *
 * - **Only the person's own data.** Public procurement records are referenced
 *   by title and source link, not copied wholesale; the export is about what
 *   Luma holds *about the user*, and a dump of the Doffin corpus would bury
 *   that.
 * - **No secrets.** Session token hashes and share tokens are excluded. A share
 *   token is a live credential, and an export file gets mailed around.
 */

export interface UserDataExport {
  readonly eksportertTidspunkt: string;
  readonly konto: Record<string, unknown>;
  readonly varslingsprofiler: readonly Record<string, unknown>[];
  readonly varslingspreferanser: Record<string, unknown> | null;
  readonly lagredeAnbud: readonly Record<string, unknown>[];
  readonly tilbakemeldinger: readonly Record<string, unknown>[];
  readonly delingslenker: readonly Record<string, unknown>[];
  readonly samtykkehistorikk: readonly Record<string, unknown>[];
}

export async function buildUserDataExport(db: Database, userId: string): Promise<UserDataExport> {
  const [account] = await db
    .select({
      id: schema.users.id,
      epost: schema.users.email,
      navn: schema.users.name,
      opprettet: schema.users.createdAt,
      sistInnlogget: schema.users.lastLoginAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  const [profiles, preferences, saved, feedback, shares, consents] = await Promise.all([
    db
      .select({
        id: schema.alertProfiles.id,
        navn: schema.alertProfiles.name,
        beskrivelse: schema.alertProfiles.description,
        aktiv: schema.alertProfiles.active,
        frekvens: schema.alertProfiles.frequency,
        tarMedPlanlagteAnskaffelser: schema.alertProfiles.includePlannedProcurements,
        minsteTreffscore: schema.alertProfiles.minimumMatchScore,
        opprettet: schema.alertProfiles.createdAt,
      })
      .from(schema.alertProfiles)
      .where(and(eq(schema.alertProfiles.userId, userId), isNull(schema.alertProfiles.deletedAt))),
    db
      .select({
        anbudsvarslerPa: schema.notificationPreferences.tenderAlertsEnabled,
        umiddelbareVarslerPa: schema.notificationPreferences.immediateAlertsEnabled,
        sammendragPa: schema.notificationPreferences.digestEnabled,
        visLumaInnhold: schema.notificationPreferences.includeLumaPromotionsInTenderEmails,
      })
      .from(schema.notificationPreferences)
      .where(eq(schema.notificationPreferences.userId, userId))
      .limit(1),
    db
      .select({
        anbudsId: schema.userTenderStates.tenderId,
        tittel: schema.tenders.title,
        kildelenke: schema.tenders.sourceUrl,
        status: schema.userTenderStates.state,
        lagret: schema.userTenderStates.savedAt,
        notat: schema.userTenderStates.note,
      })
      .from(schema.userTenderStates)
      .innerJoin(schema.tenders, eq(schema.tenders.id, schema.userTenderStates.tenderId))
      .where(eq(schema.userTenderStates.userId, userId)),
    db
      .select({
        anbudsId: schema.relevanceFeedback.tenderId,
        vurdering: schema.relevanceFeedback.verdict,
        kommentar: schema.relevanceFeedback.comment,
        tidspunkt: schema.relevanceFeedback.createdAt,
      })
      .from(schema.relevanceFeedback)
      .where(eq(schema.relevanceFeedback.userId, userId)),
    db
      .select({
        // The token itself is deliberately absent: it is a live credential.
        anbudsId: schema.tenderShares.tenderId,
        opprettet: schema.tenderShares.createdAt,
        utloper: schema.tenderShares.expiresAt,
        opphevet: schema.tenderShares.revokedAt,
        visninger: schema.tenderShares.viewCount,
      })
      .from(schema.tenderShares)
      .where(eq(schema.tenderShares.createdByUserId, userId)),
    db
      .select({
        type: schema.consentEvents.consentType,
        status: schema.consentEvents.status,
        kilde: schema.consentEvents.source,
        tekstversjon: schema.consentEvents.consentTextVersion,
        tidspunkt: schema.consentEvents.occurredAt,
      })
      .from(schema.consentEvents)
      .where(eq(schema.consentEvents.userId, userId)),
  ]);

  return {
    eksportertTidspunkt: new Date().toISOString(),
    konto: account ?? {},
    varslingsprofiler: profiles,
    varslingspreferanser: preferences[0] ?? null,
    lagredeAnbud: saved,
    tilbakemeldinger: feedback,
    delingslenker: shares,
    samtykkehistorikk: consents,
  };
}
