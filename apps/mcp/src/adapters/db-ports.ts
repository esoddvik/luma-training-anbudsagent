import { and, desc, eq, gte, ilike, inArray, isNull, lte, ne, or, sql } from 'drizzle-orm';
import type { Database } from '@luma/db';
import {
  alertProfileBuyers,
  alertProfileCpvCodes,
  alertProfileGeographies,
  alertProfileKeywords,
  alertProfiles,
  mcpAuditEvents,
  mcpTokens,
  tenderChangeEvents,
  tenderCpvCodes,
  tenderRegions,
  tenders,
  userTenderStates,
} from '@luma/db';
import type { AlertProfile, Tender, TenderChangeEvent } from '@luma/domain';
import type {
  AuditPort,
  MatchCandidateCriteria,
  Page,
  PageRequest,
  ProfileReadPort,
  TenderReadPort,
  TenderSearchCriteria,
  ToolAuditEvent,
  ToolPorts,
  UserTenderState,
  UserTenderStatePort,
  TokenLookup,
} from '@luma/mcp-tools';

/**
 * The database adapter for the MCP tool ports.
 *
 * This is the composition root: `@luma/mcp-tools` defines the ports and never
 * imports a database client, so the tool surface can be developed and tested
 * without one. Everything that knows about tables lives here.
 *
 * Every user-scoped query filters on `userId` in SQL rather than in memory.
 * Filtering after the fact would still be correct, but it makes a leak one
 * forgotten `.filter()` away instead of impossible, and the whole point of the
 * port signatures is that isolation is structural.
 */

/** Suppressed tenders are hidden from every product surface (spec §45). */
const visible = isNull(tenders.suppressedAt);

function toTender(row: typeof tenders.$inferSelect, cpvCodes: string[], regions: string[]): Tender {
  const tender: Tender = {
    id: row.id,
    source: row.source,
    sourceId: row.sourceId,
    sourceUrl: row.sourceUrl,
    title: row.title,
    buyerName: row.buyerName,
    cpvCodes,
    regions,
    // Never populated: Doffin exposes no municipality field.
    municipalities: [],
    noticeCategory: row.noticeCategory,
    publishedAt: row.publishedAt,
    status: row.status,
    sourcePayloadHash: row.sourcePayloadHash,
    rawPayload: row.rawPayload,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    lastSyncedAt: row.lastSyncedAt,
  };

  if (row.noticeId) tender.noticeId = row.noticeId;
  if (row.description) tender.description = row.description;
  if (row.buyerOrganizationNumber) tender.buyerOrganizationNumber = row.buyerOrganizationNumber;
  if (row.noticeType) tender.noticeType = row.noticeType;
  if (row.procedureType) tender.procedureType = row.procedureType;
  if (row.estimatedValueMinNok !== null) tender.estimatedValueMinNok = row.estimatedValueMinNok;
  if (row.estimatedValueMaxNok !== null) tender.estimatedValueMaxNok = row.estimatedValueMaxNok;
  if (row.currency) tender.currency = row.currency;
  if (row.modifiedAt) tender.modifiedAt = row.modifiedAt;
  if (row.deadlineAt) tender.deadlineAt = row.deadlineAt;
  if (row.sourceRevision) tender.sourceRevision = row.sourceRevision;

  return tender;
}

/** Loads the CPV and region child rows for a set of tenders in two queries. */
async function loadTenderChildren(db: Database, ids: readonly string[]) {
  if (ids.length === 0) return { cpv: new Map(), regions: new Map() };

  const [cpvRows, regionRows] = await Promise.all([
    db
      .select()
      .from(tenderCpvCodes)
      .where(inArray(tenderCpvCodes.tenderId, [...ids])),
    db
      .select()
      .from(tenderRegions)
      .where(inArray(tenderRegions.tenderId, [...ids])),
  ]);

  const cpv = new Map<string, string[]>();
  for (const row of cpvRows) {
    cpv.set(row.tenderId, [...(cpv.get(row.tenderId) ?? []), row.cpvCode]);
  }
  const regions = new Map<string, string[]>();
  for (const row of regionRows) {
    regions.set(row.tenderId, [...(regions.get(row.tenderId) ?? []), row.regionCode]);
  }
  return { cpv, regions };
}

async function hydrate(db: Database, rows: Array<typeof tenders.$inferSelect>): Promise<Tender[]> {
  const { cpv, regions } = await loadTenderChildren(
    db,
    rows.map((row) => row.id),
  );
  return rows.map((row) => toTender(row, cpv.get(row.id) ?? [], regions.get(row.id) ?? []));
}

export function createTenderReadPort(db: Database): TenderReadPort {
  return {
    async searchTenders(criteria: TenderSearchCriteria, page: PageRequest): Promise<Page<Tender>> {
      const conditions = [visible];

      if (criteria.text) {
        const pattern = `%${criteria.text}%`;
        const textMatch = or(ilike(tenders.title, pattern), ilike(tenders.description, pattern));
        if (textMatch) conditions.push(textMatch);
      }
      if (criteria.buyer) conditions.push(ilike(tenders.buyerName, `%${criteria.buyer}%`));
      if (criteria.noticeCategory) {
        conditions.push(eq(tenders.noticeCategory, criteria.noticeCategory));
      }
      if (criteria.status) conditions.push(eq(tenders.status, criteria.status));
      if (criteria.publishedAfter)
        conditions.push(gte(tenders.publishedAt, criteria.publishedAfter));
      if (criteria.deadlineBefore)
        conditions.push(lte(tenders.deadlineAt, criteria.deadlineBefore));
      if (criteria.deadlineAfter) conditions.push(gte(tenders.deadlineAt, criteria.deadlineAfter));

      if (criteria.cpvCodes && criteria.cpvCodes.length > 0) {
        conditions.push(
          sql`exists (select 1 from ${tenderCpvCodes} c where c.tender_id = ${tenders.id} and c.cpv_code = any(${sql.param(criteria.cpvCodes)}))`,
        );
      }
      if (criteria.regions && criteria.regions.length > 0) {
        conditions.push(
          sql`exists (select 1 from ${tenderRegions} r where r.tender_id = ${tenders.id} and r.region_code = any(${sql.param(criteria.regions)}))`,
        );
      }

      // One row beyond the page, so `hasMore` is answered without a count(*)
      // over the whole match set.
      const rows = await db
        .select()
        .from(tenders)
        .where(and(...conditions))
        .orderBy(desc(tenders.publishedAt), desc(tenders.id))
        .limit(page.limit + 1)
        .offset(page.offset);

      const hasMore = rows.length > page.limit;
      return { items: await hydrate(db, rows.slice(0, page.limit)), hasMore };
    },

    async getTender(tenderId: string): Promise<Tender | undefined> {
      const rows = await db
        .select()
        .from(tenders)
        .where(and(eq(tenders.id, tenderId), visible))
        .limit(1);
      const hydrated = await hydrate(db, rows);
      return hydrated[0];
    },

    async listChanges(tenderId: string): Promise<readonly TenderChangeEvent[]> {
      const rows = await db
        .select()
        .from(tenderChangeEvents)
        .where(eq(tenderChangeEvents.tenderId, tenderId))
        .orderBy(desc(tenderChangeEvents.detectedAt))
        .limit(50);

      return rows.map((row) => {
        const event: TenderChangeEvent = {
          id: row.id,
          tenderId: row.tenderId,
          kind: row.kind,
          summary: row.summary,
          detectedAt: row.detectedAt,
        };
        if (row.previousValue) event.previousValue = row.previousValue;
        if (row.currentValue) event.currentValue = row.currentValue;
        if (row.sourceRevision) event.sourceRevision = row.sourceRevision;
        return event;
      });
    },

    async listMatchCandidates(
      criteria: MatchCandidateCriteria,
      maxCandidates: number,
    ): Promise<readonly Tender[]> {
      // Awards are excluded here as well as in the matching engine. Two
      // independent guards, because this one is the cheap one and the engine's
      // is the correct one.
      const conditions = [visible, ne(tenders.noticeCategory, 'award')];

      if (!criteria.includePlanned) {
        conditions.push(ne(tenders.noticeCategory, 'planned'));
      }
      if (criteria.publishedAfter) {
        conditions.push(gte(tenders.publishedAt, criteria.publishedAfter));
      }
      if (criteria.deadlineBefore) {
        conditions.push(lte(tenders.deadlineAt, criteria.deadlineBefore));
      }

      const rows = await db
        .select()
        .from(tenders)
        .where(and(...conditions))
        .orderBy(desc(tenders.publishedAt), desc(tenders.id))
        .limit(maxCandidates);

      return hydrate(db, rows);
    },
  };
}

export function createProfileReadPort(db: Database): ProfileReadPort {
  async function load(userId: string, profileId?: string): Promise<AlertProfile[]> {
    const conditions = [eq(alertProfiles.userId, userId), isNull(alertProfiles.deletedAt)];
    if (profileId) conditions.push(eq(alertProfiles.id, profileId));

    const rows = await db
      .select()
      .from(alertProfiles)
      .where(and(...conditions));
    if (rows.length === 0) return [];

    const ids = rows.map((row) => row.id);
    const [cpv, keywords, geographies, buyers] = await Promise.all([
      db
        .select()
        .from(alertProfileCpvCodes)
        .where(inArray(alertProfileCpvCodes.alertProfileId, ids)),
      db
        .select()
        .from(alertProfileKeywords)
        .where(inArray(alertProfileKeywords.alertProfileId, ids)),
      db
        .select()
        .from(alertProfileGeographies)
        .where(inArray(alertProfileGeographies.alertProfileId, ids)),
      db.select().from(alertProfileBuyers).where(inArray(alertProfileBuyers.alertProfileId, ids)),
    ]);

    return rows.map((row) => {
      const own = <T extends { alertProfileId: string }>(list: T[]) =>
        list.filter((entry) => entry.alertProfileId === row.id);

      const profile: AlertProfile = {
        id: row.id,
        userId: row.userId,
        name: row.name,
        active: row.active,
        cpvInclude: own(cpv)
          .filter((c) => c.mode === 'include')
          .map((c) => c.cpvCode),
        cpvExclude: own(cpv)
          .filter((c) => c.mode === 'exclude')
          .map((c) => c.cpvCode),
        keywordsInclude: own(keywords)
          .filter((k) => k.mode === 'include')
          .map((k) => k.keyword),
        keywordsExclude: own(keywords)
          .filter((k) => k.mode === 'exclude')
          .map((k) => k.keyword),
        regionsInclude: own(geographies)
          .filter((g) => g.kind === 'region')
          .map((g) => g.code),
        municipalitiesInclude: own(geographies)
          .filter((g) => g.kind === 'municipality')
          .map((g) => g.code),
        buyerInclude: own(buyers)
          .filter((b) => b.mode === 'include')
          .map((b) => b.buyerName),
        buyerExclude: own(buyers)
          .filter((b) => b.mode === 'exclude')
          .map((b) => b.buyerName),
        noticeTypes: row.noticeTypes,
        includePlannedProcurements: row.includePlannedProcurements,
        procedureTypes: row.procedureTypes,
        frequency: row.frequency,
        digestHourLocal: row.digestHourLocal,
        timezone: row.timezone,
        minimumMatchScore: row.minimumMatchScore,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };

      if (row.description) profile.description = row.description;
      if (row.serviceTemplateId) profile.serviceTemplateId = row.serviceTemplateId;
      if (row.estimatedValueMinNok !== null) {
        profile.estimatedValueMinNok = row.estimatedValueMinNok;
      }
      if (row.estimatedValueMaxNok !== null) {
        profile.estimatedValueMaxNok = row.estimatedValueMaxNok;
      }
      if (row.deadlineMinimumDays !== null) {
        profile.deadlineMinimumDays = row.deadlineMinimumDays;
      }
      return profile;
    });
  }

  return {
    listProfiles: (userId) => load(userId),
    // Scoped by user in SQL, so another user's profile id simply finds nothing
    // rather than being found and then rejected.
    getProfile: async (userId, profileId) => (await load(userId, profileId))[0],
  };
}

function toState(row: typeof userTenderStates.$inferSelect): UserTenderState {
  return {
    userId: row.userId,
    tenderId: row.tenderId,
    saved: row.state === 'saved',
    savedAt: row.savedAt,
    dismissed: row.state === 'dismissed',
    dismissedAt: row.dismissedAt,
  };
}

export function createUserTenderStatePort(db: Database): UserTenderStatePort {
  async function upsert(
    userId: string,
    tenderId: string,
    at: Date,
    state: 'saved' | 'dismissed',
  ): Promise<UserTenderState> {
    const rows = await db
      .insert(userTenderStates)
      .values({
        userId,
        tenderId,
        state,
        savedAt: state === 'saved' ? at : null,
        dismissedAt: state === 'dismissed' ? at : null,
      })
      .onConflictDoUpdate({
        target: [userTenderStates.userId, userTenderStates.tenderId],
        set: {
          state,
          // The other timestamp is left alone: a user who saves a tender they
          // previously dismissed should not lose the record of having
          // dismissed it, and support reads both.
          ...(state === 'saved' ? { savedAt: at } : { dismissedAt: at }),
          updatedAt: at,
        },
      })
      .returning();

    const row = rows[0];
    if (!row) throw new Error('upsert of user tender state returned no row');
    return toState(row);
  }

  return {
    async getState(userId, tenderId) {
      const rows = await db
        .select()
        .from(userTenderStates)
        .where(and(eq(userTenderStates.userId, userId), eq(userTenderStates.tenderId, tenderId)))
        .limit(1);
      const row = rows[0];
      return row ? toState(row) : undefined;
    },

    async listStates(userId, tenderIds) {
      if (tenderIds.length === 0) return [];
      const rows = await db
        .select()
        .from(userTenderStates)
        .where(
          and(
            eq(userTenderStates.userId, userId),
            inArray(userTenderStates.tenderId, [...tenderIds]),
          ),
        );
      return rows.map(toState);
    },

    saveTender: (userId, tenderId, at) => upsert(userId, tenderId, at, 'saved'),
    dismissTender: (userId, tenderId, at) => upsert(userId, tenderId, at, 'dismissed'),
  };
}

/**
 * The audit port.
 *
 * The event type it receives carries no free text by construction, so there is
 * nothing here to sanitise; this writes ids, an outcome and a duration. Spec
 * §9.5 forbids storing conversation content, and the way that is guaranteed is
 * that no field exists to put it in.
 */
export function createAuditPort(db: Database): AuditPort {
  return {
    async record(event: ToolAuditEvent): Promise<void> {
      // A refused call is recorded as `denied` rather than lumped in with
      // `error`, because the two need different responses: a spike in denials
      // is a scope or revocation problem, a spike in errors is a bug.
      const outcome =
        event.outcome === 'ok' ? 'ok' : event.outcome === 'forbidden' ? 'denied' : 'error';

      await db.insert(mcpAuditEvents).values({
        tokenId: event.tokenId,
        userId: event.userId,
        tool: event.toolName,
        scopeChecked: event.missingScope ?? event.requiredScopes.join(','),
        outcome,
        errorCode: event.outcome === 'ok' ? null : event.outcome,
        durationMs: event.durationMs,
        occurredAt: event.occurredAt,
      });
    },
  };
}

/**
 * Looks a bearer token up by its peppered hash.
 *
 * `lastUsedAt` is updated as a side effect so a user can see which of their
 * tokens are actually in use before revoking one.
 */
export function createTokenLookup(db: Database): TokenLookup {
  return async (tokenHash: string) => {
    const rows = await db
      .select()
      .from(mcpTokens)
      .where(eq(mcpTokens.tokenHash, tokenHash))
      .limit(1);

    const row = rows[0];
    if (!row) return undefined;

    void db
      .update(mcpTokens)
      .set({ lastUsedAt: new Date() })
      .where(eq(mcpTokens.id, row.id))
      .catch(() => {
        // Recording use is bookkeeping. Failing it must not fail the request.
      });

    return {
      tokenId: row.id,
      userId: row.userId,
      scopes: row.scopes,
      revokedAt: row.revokedAt,
      expiresAt: row.expiresAt,
    };
  };
}

export function createToolPorts(db: Database): ToolPorts {
  return {
    tenders: createTenderReadPort(db),
    profiles: createProfileReadPort(db),
    userTenderState: createUserTenderStatePort(db),
    audit: createAuditPort(db),
  };
}
