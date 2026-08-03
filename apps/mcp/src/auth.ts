/**
 * Bearer-token authentication for the MCP server (spec §30).
 *
 * The implementation lives in `@luma/mcp-tools` because every tool must call
 * `requireScope` before it touches data, and a package cannot depend on an
 * app. This module re-exports it so the transport layer keeps one import path
 * and there is exactly one definition of a scope in the repository.
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
} from '@luma/mcp-tools';
