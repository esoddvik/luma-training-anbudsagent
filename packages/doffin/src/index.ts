export {
  TenderSourceError,
  type FetchNoticesInput,
  type FetchNoticesResult,
  type TenderSourceAdapter,
} from './adapter.js';
export {
  doffinSearchHitSchema,
  doffinSearchResponseSchema,
  parsePublicationDateSafe,
  type DoffinSearchHit,
  type DoffinSearchResponse,
  type SourceTenderNotice,
} from './source-notice.js';
export {
  deriveNoticeCategory,
  deriveStatus,
  isPlannedType,
  KNOWN_NOTICE_TYPES,
  type Derived,
  type DerivationWarning,
  type KnownNoticeType,
} from './notice-type.js';
export {
  buildSourceUrl,
  extractWinners,
  hashPayload,
  normalizeSearchHit,
  parsePublicationDate,
  partitionLocations,
  DOFFIN_NOTICE_URL_BASE,
  NATIONWIDE_LOCATION,
  UNSPECIFIED_LOCATION,
  type NormalizedTender,
  type NormalizeOptions,
} from './normalize.js';
export {
  DoffinApiAdapter,
  DOFFIN_DEFAULT_PAGE_SIZE,
  DOFFIN_MAX_ACCESSIBLE_HITS,
  type DoffinApiAdapterOptions,
} from './doffin-api-adapter.js';
export { FixtureTenderSourceAdapter } from './fixture-adapter.js';
export {
  runSync,
  windowStart,
  DEFAULT_OVERLAP_DAYS,
  type SyncCheckpoint,
  type SyncOptions,
  type SyncResult,
} from './sync.js';
