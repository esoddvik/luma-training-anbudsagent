import type {
  AlertProfile,
  NoticeCategory,
  Tender,
  TenderChangeEvent,
  TenderStatus,
} from '@luma/domain';
import type { McpScope } from './auth.js';

/**
 * Repository ports: the only way a tool reaches data.
 *
 * These are narrow interfaces stated in domain vocabulary, not a database
 * client. Two properties matter and both are structural rather than
 * remembered:
 *
 * 1. **Every method that returns user-scoped data takes `userId` as its first
 *    argument.** There is no ambient "current user". A tool that forgot to
 *    scope a read would not compile, because there is no method to call that
 *    would return another user's rows.
 * 2. **Reads and writes are separate interfaces.** `UserTenderStateReadPort`
 *    has no write method at all, and the registry hands read tools an object
 *    that only implements the read half (spec section 40: a read tool cannot
 *    write). It is not a convention a future edit can quietly break.
 *
 * Tender data itself is public source data and is not user-scoped, so those
 * methods take no `userId`. That is the one deliberate exception.
 *
 * The database adapter is written elsewhere against these interfaces. The
 * in-memory implementation in `./testing/in-memory-ports.js` is the one this
 * package's tests run against.
 */

/* -------------------------------------------------------------------------- */
/* Paging                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * One page of a listing.
 *
 * `offset` rather than a keyset cursor because the cursor a caller sees is
 * opaque (see `./pagination.js`): swapping this for a keyset scheme later
 * changes the adapter and the codec, not the tool surface.
 */
export interface PageRequest {
  /** Already capped by `resolveLimit`; an adapter may trust it. */
  readonly limit: number;
  readonly offset: number;
}

export interface Page<T> {
  readonly items: readonly T[];
  /** True when at least one further row exists past this page. */
  readonly hasMore: boolean;
}

/* -------------------------------------------------------------------------- */
/* Tenders                                                                    */
/* -------------------------------------------------------------------------- */

/** The filter set of `search_tenders` (spec section 32.1), in domain terms. */
export interface TenderSearchCriteria {
  /** Free-text phrase, matched whole-word against title and description. */
  readonly text?: string;
  readonly cpvCodes?: readonly string[];
  readonly regions?: readonly string[];
  readonly buyer?: string;
  readonly noticeCategory?: NoticeCategory;
  readonly publishedAfter?: Date;
  readonly deadlineBefore?: Date;
  readonly deadlineAfter?: Date;
  readonly status?: TenderStatus;
}

/**
 * The candidate set `find_matching_tenders` scores.
 *
 * Award notices are never candidates. Spec section 13 keeps them in the store
 * because they arrive in the same stream, and section 32.3 defers
 * `search_awards` to phase 8; the matching engine excludes them as well, so
 * this is the outer of two independent guards.
 */
export interface MatchCandidateCriteria {
  readonly includePlanned: boolean;
  readonly publishedAfter?: Date;
  readonly deadlineBefore?: Date;
}

export interface TenderReadPort {
  searchTenders(criteria: TenderSearchCriteria, page: PageRequest): Promise<Page<Tender>>;
  getTender(tenderId: string): Promise<Tender | undefined>;
  /** Change history for one notice (spec section 13, 32.1 `get_tender`). */
  listChanges(tenderId: string): Promise<readonly TenderChangeEvent[]>;
  /**
   * Tenders eligible for scoring, newest first, bounded by `maxCandidates`.
   *
   * Scoring happens in the tool because ranking is the matching engine's job
   * and must not be reimplemented in SQL (ADR-0004). The bound is what keeps
   * "score everything" from becoming a table scan; see `MAX_MATCH_CANDIDATES`.
   */
  listMatchCandidates(
    criteria: MatchCandidateCriteria,
    maxCandidates: number,
  ): Promise<readonly Tender[]>;
}

/* -------------------------------------------------------------------------- */
/* Alert profiles                                                             */
/* -------------------------------------------------------------------------- */

export interface ProfileReadPort {
  listProfiles(userId: string): Promise<readonly AlertProfile[]>;
  /** Resolves only within `userId`. Another user's id yields `undefined`. */
  getProfile(userId: string, profileId: string): Promise<AlertProfile | undefined>;
}

/* -------------------------------------------------------------------------- */
/* Saved and dismissed tenders                                                */
/* -------------------------------------------------------------------------- */

export interface UserTenderState {
  readonly userId: string;
  readonly tenderId: string;
  readonly saved: boolean;
  readonly savedAt: Date | null;
  readonly dismissed: boolean;
  readonly dismissedAt: Date | null;
}

export interface UserTenderStateReadPort {
  getState(userId: string, tenderId: string): Promise<UserTenderState | undefined>;
  listStates(userId: string, tenderIds: readonly string[]): Promise<readonly UserTenderState[]>;
}

/**
 * The write half. Both methods take an exact tender id and nothing else: spec
 * section 40 forbids a write tool that acts on a filter or a predicate.
 */
export interface UserTenderStateWritePort {
  saveTender(userId: string, tenderId: string, at: Date): Promise<UserTenderState>;
  dismissTender(userId: string, tenderId: string, at: Date): Promise<UserTenderState>;
}

export type UserTenderStatePort = UserTenderStateReadPort & UserTenderStateWritePort;

/* -------------------------------------------------------------------------- */
/* Audit                                                                      */
/* -------------------------------------------------------------------------- */

export type ToolOutcome =
  'ok' | 'forbidden' | 'invalid_input' | 'not_found' | 'conflict' | 'internal_error';

/**
 * One audit row per tool call (spec section 40, ADR-0003).
 *
 * The field list is closed on purpose. Spec section 9.5 says conversation
 * content is not stored, so there is no field a search phrase, a keyword, a
 * buyer name or a free-text reason could be written into: ids, counts, scope
 * names and an outcome, nothing else. `invokeTool` additionally discards any
 * target id that does not look like an id before recording it, so a tool with
 * a bug cannot smuggle text through those two fields either.
 */
export interface ToolAuditEvent {
  readonly toolName: string;
  readonly userId: string;
  readonly tokenId: string;
  readonly outcome: ToolOutcome;
  readonly requiredScopes: readonly McpScope[];
  /** The scope that was missing, when the outcome is `forbidden`. */
  readonly missingScope: McpScope | null;
  readonly targetTenderId: string | null;
  readonly targetProfileId: string | null;
  readonly resultCount: number | null;
  readonly durationMs: number;
  readonly occurredAt: Date;
}

export interface AuditPort {
  record(event: ToolAuditEvent): Promise<void>;
}

/* -------------------------------------------------------------------------- */
/* Port bundles                                                               */
/* -------------------------------------------------------------------------- */

/** Everything the tool layer is wired with. Audit is used by the registry. */
export interface ToolPorts {
  readonly tenders: TenderReadPort;
  readonly profiles: ProfileReadPort;
  readonly userTenderState: UserTenderStatePort;
  readonly audit: AuditPort;
}

/** What a read tool is handed. Note the absence of any write capability. */
export interface ReadToolPorts {
  readonly tenders: TenderReadPort;
  readonly profiles: ProfileReadPort;
  readonly userTenderState: UserTenderStateReadPort;
}

export interface WriteToolPorts extends ReadToolPorts {
  readonly userTenderState: UserTenderStatePort;
}

/**
 * Projects the full port bundle down to the read-only half.
 *
 * A fresh object with only the read methods, not the original with a narrower
 * type: a type-only narrowing would still let a handler cast its way back to
 * `saveTender`. After this call the method is not present at runtime, and a
 * test asserts that.
 */
export function readOnlyPorts(ports: ToolPorts): ReadToolPorts {
  return {
    tenders: ports.tenders,
    profiles: ports.profiles,
    userTenderState: {
      getState: (userId, tenderId) => ports.userTenderState.getState(userId, tenderId),
      listStates: (userId, tenderIds) => ports.userTenderState.listStates(userId, tenderIds),
    },
  };
}

/** Write tools get the full state port plus the same reads. */
export function writeToolPorts(ports: ToolPorts): WriteToolPorts {
  return {
    tenders: ports.tenders,
    profiles: ports.profiles,
    userTenderState: ports.userTenderState,
  };
}
