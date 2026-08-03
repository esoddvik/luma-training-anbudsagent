import {
  containsPhrase,
  normalizeSearchText,
  type AlertProfile,
  type Tender,
  type TenderChangeEvent,
} from '@luma/domain';
import { isNationwide } from '@luma/matching';
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
} from '../ports.js';

/**
 * In-memory implementations of every port.
 *
 * These are the implementations this package's tests run against, and they are
 * exported from `@luma/mcp-tools/testing` so the server can be demonstrated
 * end to end before the database adapter exists. They are not a mock: they
 * implement the same contract, including user scoping, so a test that passes
 * here is testing the tool's real behaviour rather than a stub's.
 *
 * Everything is deterministic: fixed ordering, no clock read, no randomness.
 */

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

/** Doffin publishes 8-digit codes; a profile may carry a check digit. */
function baseCpv(code: string): string {
  return code.split('-')[0] ?? code;
}

function matchesText(tender: Tender, text: string): boolean {
  const haystack = `${tender.title} ${tender.description ?? ''}`;
  return containsPhrase(haystack, text);
}

function matchesRegion(tender: Tender, regions: readonly string[]): boolean {
  // `anyw` means the notice covers the whole country (Doffin findings §9), so
  // it answers any regional query rather than none.
  if (isNationwide(tender)) return true;
  const wanted = regions.map(normalizeSearchText);
  return tender.regions.some((region) => wanted.includes(normalizeSearchText(region)));
}

function newestFirst(a: Tender, b: Tender): number {
  const byDate = b.publishedAt.getTime() - a.publishedAt.getTime();
  if (byDate !== 0) return byDate;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function matchesSearch(tender: Tender, criteria: TenderSearchCriteria): boolean {
  if (criteria.text !== undefined && !matchesText(tender, criteria.text)) return false;

  if (criteria.cpvCodes !== undefined && criteria.cpvCodes.length > 0) {
    const wanted = new Set(criteria.cpvCodes.map(baseCpv));
    if (!tender.cpvCodes.some((code) => wanted.has(baseCpv(code)))) return false;
  }

  if (criteria.regions !== undefined && criteria.regions.length > 0) {
    if (!matchesRegion(tender, criteria.regions)) return false;
  }

  if (criteria.buyer !== undefined && !containsPhrase(tender.buyerName, criteria.buyer)) {
    return false;
  }

  if (criteria.noticeCategory !== undefined && tender.noticeCategory !== criteria.noticeCategory) {
    return false;
  }

  if (criteria.status !== undefined && tender.status !== criteria.status) return false;

  if (criteria.publishedAfter !== undefined && tender.publishedAt < criteria.publishedAfter) {
    return false;
  }

  if (criteria.deadlineBefore !== undefined) {
    if (tender.deadlineAt === undefined || tender.deadlineAt > criteria.deadlineBefore) {
      return false;
    }
  }

  if (criteria.deadlineAfter !== undefined) {
    if (tender.deadlineAt === undefined || tender.deadlineAt < criteria.deadlineAfter) {
      return false;
    }
  }

  return true;
}

/* -------------------------------------------------------------------------- */
/* Seed                                                                       */
/* -------------------------------------------------------------------------- */

export interface InMemorySeed {
  readonly tenders?: readonly Tender[];
  readonly profiles?: readonly AlertProfile[];
  readonly changes?: readonly TenderChangeEvent[];
  readonly states?: readonly UserTenderState[];
}

export interface InMemoryPorts extends ToolPorts {
  /** Every audit row recorded so far, in order. */
  readonly auditEvents: readonly ToolAuditEvent[];
  /** Current saved/dismissed rows, for assertions about writes. */
  readonly savedStates: readonly UserTenderState[];
}

export function createInMemoryPorts(seed: InMemorySeed = {}): InMemoryPorts {
  const tenders = [...(seed.tenders ?? [])];
  const profiles = [...(seed.profiles ?? [])];
  const changes = [...(seed.changes ?? [])];
  const states = new Map<string, UserTenderState>(
    (seed.states ?? []).map((state) => [`${state.userId}:${state.tenderId}`, state]),
  );
  const auditEvents: ToolAuditEvent[] = [];

  const tenderPort: TenderReadPort = {
    async searchTenders(criteria: TenderSearchCriteria, page: PageRequest): Promise<Page<Tender>> {
      const matched = tenders.filter((tender) => matchesSearch(tender, criteria)).sort(newestFirst);
      // One row past the page is fetched, which is how a SQL adapter answers
      // `hasMore` without a second COUNT query.
      const window = matched.slice(page.offset, page.offset + page.limit + 1);
      const items = window.slice(0, page.limit);
      return { items, hasMore: window.length > items.length };
    },

    async getTender(tenderId: string): Promise<Tender | undefined> {
      return tenders.find((tender) => tender.id === tenderId);
    },

    async listChanges(tenderId: string): Promise<readonly TenderChangeEvent[]> {
      return changes
        .filter((change) => change.tenderId === tenderId)
        .sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
    },

    async listMatchCandidates(
      criteria: MatchCandidateCriteria,
      maxCandidates: number,
    ): Promise<readonly Tender[]> {
      return tenders
        .filter((tender) => {
          if (tender.noticeCategory === 'award') return false;
          if (!criteria.includePlanned && tender.noticeCategory === 'planned') return false;
          if (criteria.publishedAfter !== undefined && tender.publishedAt < criteria.publishedAfter)
            return false;
          if (criteria.deadlineBefore !== undefined) {
            if (tender.deadlineAt !== undefined && tender.deadlineAt > criteria.deadlineBefore) {
              return false;
            }
          }
          return true;
        })
        .sort(newestFirst)
        .slice(0, maxCandidates);
    },
  };

  const profilePort: ProfileReadPort = {
    async listProfiles(userId: string): Promise<readonly AlertProfile[]> {
      return profiles
        .filter((profile) => profile.userId === userId)
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    },

    async getProfile(userId: string, profileId: string): Promise<AlertProfile | undefined> {
      // Scoped by user, so another user's id is indistinguishable from a
      // nonexistent one (ADR-0003).
      return profiles.find((profile) => profile.userId === userId && profile.id === profileId);
    },
  };

  function upsert(
    userId: string,
    tenderId: string,
    change: (current: UserTenderState) => UserTenderState,
  ): UserTenderState {
    const key = `${userId}:${tenderId}`;
    const current: UserTenderState = states.get(key) ?? {
      userId,
      tenderId,
      saved: false,
      savedAt: null,
      dismissed: false,
      dismissedAt: null,
    };
    const next = change(current);
    states.set(key, next);
    return next;
  }

  const statePort: UserTenderStatePort = {
    async getState(userId: string, tenderId: string): Promise<UserTenderState | undefined> {
      return states.get(`${userId}:${tenderId}`);
    },

    async listStates(
      userId: string,
      tenderIds: readonly string[],
    ): Promise<readonly UserTenderState[]> {
      const wanted = new Set(tenderIds);
      return [...states.values()].filter(
        (state) => state.userId === userId && wanted.has(state.tenderId),
      );
    },

    async saveTender(userId: string, tenderId: string, at: Date): Promise<UserTenderState> {
      // Saving un-dismisses: the two are opposite answers to the same
      // question, and holding both would make the tender's state ambiguous.
      return upsert(userId, tenderId, (current) => ({
        ...current,
        saved: true,
        savedAt: at,
        dismissed: false,
        dismissedAt: null,
      }));
    },

    async dismissTender(userId: string, tenderId: string, at: Date): Promise<UserTenderState> {
      return upsert(userId, tenderId, (current) => ({
        ...current,
        saved: false,
        savedAt: null,
        dismissed: true,
        dismissedAt: at,
      }));
    },
  };

  const auditPort: AuditPort = {
    async record(event: ToolAuditEvent): Promise<void> {
      auditEvents.push(event);
    },
  };

  return {
    tenders: tenderPort,
    profiles: profilePort,
    userTenderState: statePort,
    audit: auditPort,
    get auditEvents(): readonly ToolAuditEvent[] {
      return auditEvents;
    },
    get savedStates(): readonly UserTenderState[] {
      return [...states.values()];
    },
  };
}
