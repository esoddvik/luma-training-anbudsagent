# ADR-0002: Stable MCP SDK

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §29, §31, §49 (ADR 2), §50 (phase 5)

## Context

The MCP server is not a side feature. Spec §29 states that it is simultaneously a product surface and Luma Training's foremost demonstration surface: it is the professional version of the Doffin agent that course participants are taught to assemble themselves. The phase 5 acceptance criterion in §50 is that a full demo (connect, find matches, explain a match) runs stably in under five minutes, in both ChatGPT and Claude.

The Model Context Protocol moves quickly. The TypeScript SDK regularly ships features behind experimental or alpha flags, and transport semantics have changed more than once. A protocol-level change that breaks the connection handshake would surface on stage, in front of the target audience, with no way to debug it.

Spec §29 is explicit: use the stable MCP TypeScript SDK, pin exact versions, prefer stateless design where practical, and do not use alpha MCP features in the MVP.

## Decision

1. Depend on `@modelcontextprotocol/sdk` at an **exact** version (no `^`, no `~`) in `apps/mcp` and in `packages/mcp-tools`. The pinned version at the time of this decision is **1.30.0**. The version is bumped only as a deliberate, tested change with its own commit.
2. Use only the stable Streamable HTTP transport. No SSE fallback experiments, no alpha capabilities, no features documented as experimental in the SDK release notes for the pinned version.
3. Design the server stateless per request wherever the protocol allows. Session identity comes from the bearer token (ADR-0003) resolved against PostgreSQL on each call; no in-memory per-connection state that a restart or a second replica would lose.
4. Tool schemas, resource URIs and prompt definitions live in `packages/mcp-tools` and are declared with Zod. `apps/mcp` is a thin transport and auth shell around them. If the SDK's declaration API changes, one package changes.
5. Before any SDK version bump, run the demo script end to end against both ChatGPT and Claude as a manual gate, and record the outcome in the pull request.

## Consequences

### Positive

- The demo is reproducible. A given commit produces a given protocol behaviour, independent of when `pnpm install` last ran.
- Stateless request handling means `apps/mcp` can be restarted or scaled horizontally without dropping client sessions in a way the user would notice.
- Keeping tool definitions out of the transport layer means the MVP tool surface (§32.1) and the phase 7 surface (§32.2) are additive changes to one package.
- Refusing alpha features removes a whole class of "it worked yesterday" failures.

### Negative / trade-offs

- Exact pinning means security patches and genuine protocol improvements arrive only when someone deliberately bumps. This requires a standing review habit, not automation. Dependabot pull requests for this dependency are treated as notifications, not as merges.
- Some genuinely useful MCP features (richer elicitation, sampling) may be unavailable in the pinned stable surface for a while. Accepted: the MVP tool surface in §32.1 is deliberately slim and does not need them.
- Stateless-per-request means a token lookup on every call. Mitigated by an index on the token hash and by the fact that this is a single indexed read.

## Alternatives considered

- **Range versioning (`^x.y.z`).** Rejected. A transitive minor bump changing handshake behaviour between the rehearsal and the live demo is exactly the failure mode §29 is written to prevent.
- **Hand-rolling the Streamable HTTP protocol.** Rejected. The protocol is a moving target maintained by others; reimplementing it means owning every future compatibility bug for no product gain.
- **Using alpha SDK features to get a richer tool surface sooner.** Rejected by §29 directly, and by §53's rule that no MCP feature may be presented as implemented before it works.
- **Running MCP inside `apps/core`.** Covered in ADR-0001; rejected so that demo latency is not coupled to ingest and digest load.

## Verification

- `apps/mcp/package.json` and `packages/mcp-tools/package.json` declare `@modelcontextprotocol/sdk` as the bare exact string `1.30.0`. A CI check greps these manifests and fails on a leading `^` or `~` for that dependency.
- `pnpm list --depth 0 --filter @luma/app-mcp` in CI records the resolved version in the build log, so a change is visible in a diff of build output.
- A Vitest test asserts every tool exported from `packages/mcp-tools` has a Zod input schema and appears in the server's tool registry, so no tool can be registered ad hoc in the transport layer.
- A grep-based test asserts no source file under `apps/mcp` or `packages/mcp-tools` imports from an SDK path containing `experimental` or `alpha`.
- A test asserts the MCP request handler holds no module-level mutable map keyed by connection or session id, enforcing the stateless rule by inspection of a small, reviewed surface.
- The phase 5 demo script is checked into `docs/` (or `apps/mcp/README.md`) and its steps map one to one to the §50 acceptance criterion, so the manual gate is repeatable rather than remembered.
