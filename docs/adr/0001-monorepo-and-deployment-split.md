# ADR-0001: Monorepo and deployment split

- **Status:** Accepted
- **Date:** 2026-08-03
- **Deciders:** Luma Training (product owner), engineering
- **Spec reference:** §35, §36, §49 (ADR 1), §50 (phase 0)

## Context

Luma Anbudsvarsling is a single product with four very different runtime profiles:

1. A public and authenticated web surface with preview deployments and heavy edit iteration.
2. A long-running background pipeline (Doffin ingest, normalization, matching, digest scheduling, email send) that must not be request-bound.
3. A remote MCP server that is used in live demos on stage at webinars, NHO events and course days, where a stall is a credibility loss in front of the exact audience the service exists to reach.
4. A Postgres database that all of the above share.

Spec §35 sketches five apps (`web`, `api`, `mcp`, `worker`, `jobs`) and §36 splits hosting between Vercel and Railway, with the explicit rule that Doffin ingest must never run as a request-bound Vercel function. Spec §49 also tells us to avoid unnecessary microservices and to use one clear implementation.

A second question was whether this lives inside the existing `luma-training.com` repository. The service has its own database, its own deployment cadence, its own dependency surface (MCP SDK, pg-boss, Drizzle) and its own domain. Coupling its release cycle to the marketing site would mean every tender-pipeline change risks the company's main web presence.

## Decision

Build a standalone pnpm workspaces plus turborepo monorepo at `G:/Luma Training Anbudsagent`, separate from the `luma-training.com` repository, and deploy **three** services:

| Service | Contents | Platform |
| --- | --- | --- |
| `apps/web` | Next.js App Router: public pages, authenticated dashboard, shared view, admin UI | Vercel |
| `apps/core` | Fastify HTTP API + pg-boss worker + pg-boss cron schedules, in one Node process | Railway |
| `apps/mcp` | MCP Streamable HTTP server | Railway |

PostgreSQL is a Railway managed instance.

`apps/core` collapses the spec's `api`, `worker` and `jobs` into a single process. The `/packages` boundaries from §35 are kept exactly as specified, so `api`, `worker` and `jobs` remain separable later by adding entrypoints that import different packages. Nothing in `packages/` may import from `apps/`.

`apps/mcp` stays a separate deployment even though it could technically live inside `core`. This is deliberate: the MCP server is the demo surface (§29), and a demo must never queue behind an ingest run or a digest fan-out that happens to be saturating the same event loop. Isolation here buys predictable latency during the moments that matter commercially.

Public URL is `luma-training.com/anbudsvarsling`, as spec §9.1 step 1 and §16 specify. `apps/web` is a Next.js Multi Zone with `basePath: '/anbudsvarsling'`, reached through a rewrite on Luma Training's marketing site — a separate repository — so the service inherits an existing domain's standing rather than starting a new hostname. An earlier revision of this ADR put it on `anbudsvarsling.luma-training.com` and dropped the prefix; that was reversed before anything was deployed. What the shared origin costs — cookie scoping, Server Action origin allowlisting, and `APP_URL` becoming the only carrier of the prefix outside Next — is recorded in `docs/spec-deviations.md`.

The public and signed-in routes now match §16 verbatim. The admin routes do not: §16 puts them at `/admin/anbudsvarsling/...` and one `basePath` can only put the prefix first, so they are at `/anbudsvarsling/admin/...`. MCP is served at `mcp.luma-training.com/mcp`.

## Consequences

### Positive

- One `pnpm install`, one lockfile, one type graph. A change to the normalized `Tender` type in `packages/domain` breaks the build of every consumer immediately rather than at runtime.
- Three deploy targets instead of five means three sets of environment variables, health checks, log streams and cost lines to reason about. Operationally this is the difference between a service a small team can run and one that runs the team.
- MCP demo latency is insulated from batch load.
- Vercel keeps what it is good at: preview deployments and edge-served pages. Railway keeps what Vercel cannot do: processes that live longer than a request.
- The marketing site's release cadence and this service's release cadence are independent.

### Negative / trade-offs

- `apps/core` mixes HTTP serving and job execution in one process. A pathological job can starve the API event loop. Mitigation: job handlers do I/O-bound work (Postgres, Doffin HTTP, Postmark HTTP), pg-boss concurrency is bounded per queue, and CPU-bound matching runs in batches sized so that a single tick stays short.
- Scaling is coarser. Scaling the API also scales the worker. Accepted at MVP volume (thousands of jobs per day); the split is mechanical when it stops being true.
- Two hosting providers means two dashboards and two incident surfaces.
- A standalone repo means Luma design tokens must be duplicated or published rather than imported. `packages/ui` owns that copy.

## Alternatives considered

- **Inside the `luma-training.com` repo.** Rejected: couples release cadence, mixes an unrelated dependency tree into the main site, and makes the tender database an implicit dependency of the marketing site's CI.
- **Five deployed apps as literally listed in §35.** Rejected under §49's "avoid unnecessary microservices". At this volume the split adds operational cost without buying isolation that matters, except for MCP, where it does.
- **Everything on Railway, including the web app.** Rejected: loses Vercel preview deployments and Next.js-native hosting, both of which are used heavily in phases 3 and 4.
- **Everything on Vercel, ingest via Vercel Cron.** Rejected explicitly by §36. Ingest is a resumable, checkpointed, potentially long job; running it inside a function timeout invites partial runs, which §12 forbids from advancing the checkpoint.

## Verification

- `pnpm-workspace.yaml` lists exactly `apps/*` and `packages/*`; `ls apps/` returns exactly `web`, `core`, `mcp`.
- A lint rule (or a Vitest test walking the dependency graph of each `package.json`) asserts that no package under `packages/` declares a dependency on any `@luma/app-*` or on `apps/`.
- A test asserts `apps/mcp` does not import `pg-boss`: the MCP server must not be able to enqueue or consume background jobs.
- `apps/core` and `apps/mcp` each expose `/health` and `/ready` (§47); a CI smoke step starts each and asserts both return 200.
- Railway service config as code shows two services plus Postgres; Vercel project config shows one project pointing at `apps/web` with root directory set.
- No file under `apps/web` imports `@luma/doffin`. Ingest cannot be triggered from a Vercel request path.
