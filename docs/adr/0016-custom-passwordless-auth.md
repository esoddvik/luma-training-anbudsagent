# ADR-0016: Custom passwordless authentication and session management

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §10, §40 (see also §27, §37, §39)

## Context

Spec §10 requires passwordless email login: a magic link with a short lifetime, single use, rate limiting, generic responses to prevent account enumeration, secure HTTP-only cookies, SameSite protection, the ability to log out all sessions, and role control for admin. It states a preference for "Auth.js eller annen vedlikeholdt TypeScript-løsning", PostgreSQL-backed or securely signed sessions, and Postmark's transactional stream for delivery.

The complication is the runtime topology from ADR-0001. **Three separate runtimes need to validate the same session:**

- `apps/web`, Next.js on Vercel, rendering the dashboard and running server actions.
- `apps/core`, Fastify on Railway, serving `/api/v1/*` and running jobs.
- `apps/mcp`, which uses bearer tokens for MCP calls (ADR-0003) but still needs to resolve a user for token management surfaces and audit correlation.

Auth.js is Next-centric. Its adapters, its handlers and its session helpers assume the Next request lifecycle. Using it would mean either running the Fastify API without a first-class way to validate the same session, or reimplementing session validation in Fastify against Auth.js's table layout, which is duplicated session logic with two owners and one of them undocumented. Auth.js v5, the line that would be adopted, is also still pre-release, which would place a beta dependency on the login path, the single flow whose failure locks every user out.

Weighed against that: the flow itself is small. A random token, hashed at rest, emailed, redeemed once within a short window, exchanged for an opaque session identifier in a cookie. There is no password storage, no password reset, no credential stuffing surface, and no cryptography to design.

## Decision

Implement passwordless authentication in **`packages/auth`**, a shared package that owns the magic-link and session tables and is consumed identically by all three runtimes. Spec §10's "annen vedlikeholdt TypeScript-løsning" permits this.

**Primitives: Node's `crypto` only.** No custom cryptography, no third-party crypto library.

**Magic link:**

1. A login request generates a token from `crypto.randomBytes` with at least 32 bytes of entropy.
2. Only `sha256(token)` is stored, alongside the email, an expiry (short, minutes not hours), a `consumedAt` column, and request metadata.
3. The plaintext token is sent once, in the link, on the Postmark transactional stream (ADR-0005), using `auth-magic-link-v1`.
4. Redemption looks up by hash, compares with `crypto.timingSafeEqual`, checks expiry and `consumedAt`, then sets `consumedAt` in the same statement that claims it, so a concurrent second redemption cannot also succeed.
5. The API response to a login request is identical whether or not the email exists. No timing side channel, no different message, no different status code (§10, generic responses).
6. Rate limiting applies per email address and per source address.

**Sessions:**

- Opaque, database-backed. A session is a random identifier; the cookie carries no claims and no user data, so there is nothing to forge and nothing to leak.
- Only the session identifier's hash is stored.
- Cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`, with a bounded absolute lifetime and a rolling refresh on use.
- Validation is one function, `validateSession(rawCookieValue): SecurityContext | null`, exported from `packages/auth` and called identically by Next.js middleware and server components, by Fastify's auth hook, and by `apps/mcp` where a browser session is relevant.
- "Log out all sessions" deletes every session row for the user, which takes effect immediately because there is no cached or signed token that outlives the row.
- Admin role is a column on the user, checked against `ADMIN_EMAIL_ALLOWLIST` at provisioning time, and enforced in the service layer rather than in routing alone (§39).

**Isolation:** `packages/auth` is the only module that reads or writes the sessions and magic-link tables, and it exposes a narrow interface: `requestMagicLink`, `redeemMagicLink`, `validateSession`, `revokeSession`, `revokeAllSessionsForUser`. Nothing else touches the tables.

## Consequences

### Positive

- One implementation, three runtimes, identical semantics. A session is valid or invalid in the same way in Next.js, Fastify and MCP, because it is the same function reading the same table.
- No pre-release dependency on the login path.
- Opaque database-backed sessions make revocation genuinely immediate, which matters for §4.4 (log out all sessions) and for incident response.
- The full surface is small enough to read in one sitting and to cover exhaustively with tests, which is the honest precondition for owning security-sensitive code.
- No passwords anywhere means no hashing parameters to keep current, no reset flow to secure, and no credential-stuffing surface.

### Negative / trade-offs

- **We take on maintenance of security-sensitive code.** This is the real cost and it should not be understated. A subtle mistake here is a full account compromise, and there is no upstream maintainer who will find it for us. Mitigations: standard primitives only, no invented cryptography, a deliberately small surface, and the explicit test list below treated as a gate rather than as coverage.
- **We forgo Auth.js's provider ecosystem.** Adding Google or Microsoft SSO later means implementing OAuth ourselves or migrating. Mitigation: the token and session model is isolated behind the narrow interface above, so swapping to Auth.js later touches one package and its consumers keep calling `validateSession`.
- Every request validating a session performs a database read. Mitigated by an index on the session hash; deliberately not cached, because caching would reintroduce the revocation delay this design avoids.
- Session rows accumulate. A cleanup job removes expired sessions on the same schedule as `share.cleanup`.

## Alternatives considered

- **Auth.js v5 with the Drizzle adapter.** Rejected for the two reasons above: Next-centric, so the Fastify API would need duplicated session logic, and pre-release on the critical login path. It remains the natural migration target if the provider ecosystem becomes a requirement.
- **Auth.js in `apps/web`, with `apps/core` trusting a header set by the web app.** Rejected: it makes the API's authorization depend on a header it cannot verify, which is an authentication bypass waiting for a misconfigured proxy.
- **Signed stateless JWT sessions.** Rejected: revocation requires a denylist, which is the database read that opaque sessions already do, minus the risk of a stolen token remaining valid until expiry.
- **A hosted identity provider (Auth0, Clerk, Supabase Auth).** Rejected: adds a vendor and a per-user cost to a free service, moves user records outside the database that everything else joins against, and would still need a shared validation path for Fastify.
- **Passwords.** Rejected by §10 unless it becomes necessary.

## Verification

The following are concrete tests, each mapping to a §10 or §40 requirement:

- **Single use:** redeem a magic-link token successfully, then redeem the same token again; the second attempt fails and creates no session. A concurrent test issues two simultaneous redemptions of the same token and asserts exactly one succeeds.
- **Expiry:** a token redeemed after its expiry window fails, and the failure is indistinguishable from an unknown token.
- **Hash at rest:** a test asserts the stored token column never equals the plaintext for any generated token, that the stored value is a SHA-256 digest, and that no log line, error message or API response contains the plaintext.
- **No account enumeration:** login requests for a registered address and an unregistered address produce identical status codes, identical response bodies and identical headers. A timing test asserts the two paths do not differ by a margin that would distinguish them.
- **Timing-safe comparison:** a source-level test asserts token and session comparison uses `crypto.timingSafeEqual` and never `===` on secret material.
- **Cookie flags:** a test asserts the session cookie is set with `HttpOnly`, `Secure` and `SameSite=Lax`, and that it is absent from any response body.
- **Revoke all:** a user with three active sessions across three clients calls log-out-all; a test asserts every session row is gone and that each of the three sessions fails validation on its next request with no delay.
- **Rate limiting:** repeated login requests for the same email and from the same source are throttled, and the throttled response is identical in shape to the normal one.
- **Single owner:** an import-boundary test asserts no module outside `packages/auth` reads or writes the sessions or magic-link tables.
- **Shared validation:** a test asserts the same session value validates identically through the Next.js path and the Fastify path, and that a revoked session fails in both.
- **Admin role:** a test asserts a non-admin session receives an authorization error from every `/api/v1/admin/*` route and from the admin service functions directly, not only from the route layer.
