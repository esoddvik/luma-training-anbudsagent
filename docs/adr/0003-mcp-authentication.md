# ADR-0003: MCP authentication

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §9.5, §29, §30, §40, §49 (ADR 3)

## Context

The MCP server exposes a user's own tender data, their alert profiles and limited write actions (`save_tender`, `dismiss_tender`) to an AI client running outside our control: ChatGPT, Claude, or any other MCP-capable tool. Every call must resolve to exactly one user, and must return only that user's data (§9.5, §52 criterion 10).

Two forces pull in opposite directions. OAuth 2.1 with dynamic client registration is where the MCP ecosystem is heading and would give the cleanest consent story. But it is also the part of the ecosystem that has moved most, client support is uneven, and a consent redirect is one more thing that can fail live on stage during the phase 5 demo. Spec §29 says bearer token in the first version; §30 says the architecture must be able to support OAuth later.

The user-facing flow (§9.5) is deliberately low-ceremony: the user opens "Koble til AI", creates a token, sees the full token exactly once, and pastes an example configuration into their client.

## Decision

Use **bearer tokens** in the `Authorization` header as the only MCP authentication mechanism in the MVP, with a token model designed so that OAuth can be added beside it rather than replacing it.

Token model (`mcp_tokens`): id, user id, display name, prefix, hash, scopes, created at, last used at, expires at, revoked at.

Rules:

- The full token is generated with a cryptographically secure random source and shown to the user exactly once. Only a peppered hash (`MCP_TOKEN_PEPPER`) is stored. There is no recovery path; a lost token is revoked and replaced.
- A short non-secret `prefix` is stored in clear so the user and admin can identify which token is which in a list without ever seeing the secret.
- Comparison at validation time is timing-safe.
- Tokens are never accepted in a URL query parameter, and are never written to logs, error messages or traces (§40, §47). Only the prefix may appear in logs.
- Every token carries an explicit scope set from the fixed list in §30: `tenders:read`, `profiles:read`, `profiles:write`, `saved:read`, `saved:write`, `feedback:write`. MVP tokens are issued with read scopes plus the limited saved-actions scopes.
- **Scope is verified on every tool call**, inside the tool handler, not only at connection time. A read tool cannot write; a write tool requires an exact resource id and never a filter or query.
- Rate limiting applies per token and per user.
- Tokens can be revoked by the user and by an admin, and revocation takes effect on the next call with no cache window that could outlive it.
- Every call is written to `mcp_audit_events` with user id, token id, tool name, scope check outcome and timing. Conversation content is not stored (§9.5).

The token is resolved into a `SecurityContext { userId, tokenId, scopes }` at the transport boundary. Tool implementations in `packages/mcp-tools` take that context as an argument and cannot obtain a user id any other way. This is the seam OAuth will later plug into: an OAuth access token produces the same `SecurityContext`, and no tool changes.

## Consequences

### Positive

- Works in every MCP client today, including ones with no OAuth support. The demo has one failure mode (wrong or revoked token) instead of a redirect chain.
- Setup is a copy-paste, which matches the five-minute demo budget in §50.
- Hash-at-rest plus one-time display means a database disclosure does not yield usable credentials.
- Per-call scope checks mean adding a phase 7 write tool cannot silently widen what an existing MVP token can do.

### Negative / trade-offs

- A bearer token is a long-lived shared secret. If a user pastes it into an insecure place, it is valid until revoked. Mitigations: user-visible token list with last-used timestamps, optional expiry, one-click revoke, and admin revoke (§45).
- No per-client consent screen and no per-client identity. We know which token was used, not which application used it.
- Users must manage tokens by hand, which is friction that OAuth would remove.
- Token rotation is a manual user action.

## Alternatives considered

- **OAuth 2.1 with dynamic client registration in the MVP.** Deferred, not rejected. It is the right destination; it is not the right thing to debug on a stage in phase 5. §30 requires only that the architecture support it later, which the `SecurityContext` seam does.
- **Reusing the web session cookie.** Rejected: MCP clients are not browsers, cookies are not carried, and it would couple MCP availability to the web session model and CSRF posture.
- **Signed stateless JWTs with no database row.** Rejected: revocation is the requirement that matters most here (§4.4, §51 criterion 12), and stateless tokens make immediate revocation a denylist problem, which is a database read anyway.
- **Storing the token in clear to allow re-display.** Rejected outright by §30.

## Verification

- A test asserts that creating a token returns the plaintext exactly once and that no subsequent API response or admin view contains anything but the prefix.
- A test asserts the stored `hash` column never equals the plaintext for any generated token, and that validation of a correct token succeeds while a token differing in one character fails.
- A test asserts a revoked token is rejected on the next call, with no in-process cache allowing a successful call after revocation.
- A test per tool asserts that calling it with a token lacking the required scope returns an authorization error and performs no database write.
- A cross-user isolation test: user A's token calling `get_tender` for a tender that only user B has matched returns only source-public data, and calling `get_alert_profile` with user B's profile id returns not-found, never user B's profile.
- A log-scrubbing test feeds a full token through the pino redaction configuration and asserts the emitted line contains the prefix and not the secret.
- A test asserts the MCP router rejects a request carrying the token in a query parameter even when the header is absent.
