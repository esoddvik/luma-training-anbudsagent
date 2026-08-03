/**
 * `@luma/mcp-tools` — the MCP tool surface of Luma Anbudsvarsling (spec §32.1).
 *
 * Spec §29 calls the MCP server Luma's foremost demonstration surface: it is
 * run live on stage. That is why the guarantees here are structural rather
 * than conventional.
 *
 * 1. **Scope before data.** `invokeTool` calls `requireScope` for every scope a
 *    tool declares before the input is parsed, let alone before a port is
 *    touched (§40).
 * 2. **Read tools cannot write.** A read tool is handed a port bundle with no
 *    write method present on it at runtime, not merely typed away (§40).
 * 3. **Writes need an exact id.** `save_tender` and `dismiss_tender` accept one
 *    tender id and nothing else. There is no filter, no predicate, no bulk
 *    form (§40).
 * 4. **User isolation is in the signatures.** Every port method returning
 *    user-scoped data takes `userId`. There is no ambient current user, so a
 *    cross-user read is not something a handler can forget to prevent
 *    (ADR-0003).
 * 5. **No marketing anywhere but one tool.** `get_luma_learning_resource` is
 *    the single Luma surface (§32.1) and the only module with a path to the
 *    resource text. It is never called by another tool.
 * 6. **A score is relevance, never a win probability.** Wherever a score
 *    appears it carries `CONFIDENCE_LABEL_NB` wording and
 *    `SCORE_DISCLAIMER_NB`, and it is never a percentage (§4.3).
 * 7. **Tender text is untrusted.** Free text from a notice is returned inside a
 *    labelled envelope that states it is external data (§40, see
 *    `./untrusted.js` for the full reasoning).
 * 8. **Audit without conversation content.** Every call writes one row of ids,
 *    counts and an outcome. There is no field free text could go in (§9.5).
 *
 * The package depends on `@luma/domain` and `@luma/matching` and on no data
 * layer. Everything it reads and writes goes through the ports in `./ports.js`.
 */

export {
  authenticate,
  extractBearerToken,
  hashToken,
  requireScope,
  secretsMatch,
  ScopeError,
  MCP_SCOPES,
  TOKEN_PREFIX,
  type AuthResult,
  type AuthenticatedCaller,
  type McpScope,
  type TokenLookup,
} from './auth.js';

export {
  formatZodErrorNb,
  invalidInput,
  notFound,
  ToolError,
  INTERNAL_ERROR_NB,
  TOOL_ERROR_CODES,
  type ToolErrorCode,
} from './errors.js';

export {
  readOnlyPorts,
  writeToolPorts,
  type AuditPort,
  type MatchCandidateCriteria,
  type Page,
  type PageRequest,
  type ProfileReadPort,
  type ReadToolPorts,
  type TenderReadPort,
  type TenderSearchCriteria,
  type ToolAuditEvent,
  type ToolOutcome,
  type ToolPorts,
  type UserTenderState,
  type UserTenderStatePort,
  type UserTenderStateReadPort,
  type UserTenderStateWritePort,
  type WriteToolPorts,
} from './ports.js';

export {
  decodeCursor,
  encodeCursor,
  limitNoteNb,
  nextCursor,
  resolveLimit,
  slicePage,
  DEFAULT_PAGE_LIMIT,
  MAX_MATCH_CANDIDATES,
  MAX_PAGE_LIMIT,
} from './pagination.js';

export {
  quarantineTenderText,
  sanitizeExternalText,
  sanitizeShortField,
  EXTERNAL_TEXT_WARNING_NB,
  MAX_EXTERNAL_TEXT_CHARS,
  TRUNCATION_MARKER_NB,
  type ExternalTenderText,
} from './untrusted.js';

export * from './presentation.js';

export {
  defineReadTool,
  defineWriteTool,
  invokeToolFrom,
  type InvocationContext,
  type LumaTool,
  type ReadTool,
  type ReadToolContext,
  type ToolAuditFacts,
  type ToolInvocation,
  type WriteTool,
  type WriteToolContext,
} from './registry.js';

export * from './schemas.js';
export * from './tools/index.js';
export { LUMA_RESOURCES, findResource, type LumaResource } from './resources.js';
