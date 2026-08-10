# Luma Anbudsvarsling

A free Norwegian public-tender alert service from Luma Training.

Suppliers describe the work they are looking for, and the service watches Doffin and emails them the tenders that actually match — including **planlagte anskaffelser**, the prior-information and intention notices that appear before a competition opens. Matches are explained, sources are linked, and a tender can be shared internally with a public link. Users can also connect their own AI tool to the MCP server and query their alerts from ChatGPT or Claude.

The service is also Luma Training's marketing surface toward the supplier market. The two jobs are kept strictly apart: **commercial interest never influences which tenders are ranked highest**, and the tender email is still useful with every promotional element removed. That separation is enforced in code, not only in policy — see [ADR-6](docs/adr/0006-separation-of-ranking-and-marketing.md).

## Documentation

| Document | What it covers |
| --- | --- |
| [`Luma_Anbudsvarsling_IDE_Agent_Specification_v2.md`](Luma_Anbudsvarsling_IDE_Agent_Specification_v2.md) | The authoritative product specification (Norwegian, 54 sections). Everything else defers to it. |
| [`Luma_Anbudsvarsling_IDE_Agent_Specification_v3.md`](Luma_Anbudsvarsling_IDE_Agent_Specification_v3.md) | Supplements v2 (Norwegian, 13 sections): search-first funnel, Anbudsvarsling Pluss, document pipeline, split MCP scope. Its section numbers are its own — cite it by name. Where the two conflict, v3 wins. |
| [`docs/architecture.md`](docs/architecture.md) | System overview, package graph, data flow, deployment split. Start here. |
| [`docs/adr/`](docs/adr/) | Architecture decision records, including the ones that exist for legal or trust reasons rather than technical ones. |
| [`docs/deployment.md`](docs/deployment.md) | Where each service runs, what it needs, and how to deploy it. |

## Layout

```
apps/
  web     Next.js App Router       -> Vercel
  core    API + worker + cron jobs -> Railway
  mcp     MCP Streamable HTTP      -> Railway
packages/
  domain          shared types and Zod schemas; the bottom of the dependency graph
  db              Drizzle schema, migrations, client
  doffin          source adapter and normalisation
  matching        the deterministic scoring engine
  email           Postmark integration and templates
  auth            magic links and sessions
  ui              design tokens and primitives
  config          per-service environment validation
  observability   logging, redaction, health checks
```

`core` runs the API, the queue worker and the scheduled jobs in one process, with the package boundaries kept clean so splitting it later is mechanical. `mcp` is separate so a live demo stays responsive while an ingest or digest run is in flight. See [ADR-1](docs/adr/0001-monorepo-and-deployment-split.md).

## Getting started

Requires Node 22+, pnpm 10+, and Docker for the local database.

```bash
pnpm install
```

```bash
cp .env.example .env
```

Fill in `.env`, then start PostgreSQL and apply the migrations:

```bash
docker compose up -d && pnpm db:migrate
```

```bash
pnpm dev
```

`.env` is git-ignored and holds real credentials. Never commit it.

## Common commands

```bash
pnpm test
```

```bash
pnpm typecheck && pnpm lint && pnpm build
```

Run one workspace at a time with a filter. Apps use bare names, libraries use the `@luma/` scope:

```bash
pnpm --filter @luma/matching test
```

## Conventions

- **All customer-facing text is Norwegian bokmål.** Code, comments, schema, logs, tests and these documents are English. There is no language switcher. (Spec §6.)
- **Third-party versions live in the `catalog:` block of `pnpm-workspace.yaml`**, never as literals in a package. The MCP SDK is pinned exactly, per spec §29.
- **TypeScript is strict**, including `noUncheckedIndexedAccess`. `any` is a lint error.
- **Tests must be able to fail.** Several invariants here are held up by tests that would otherwise pass vacuously: the no-commercial-influence import check, the promotion-ordering check, the shared-view privacy check. If you touch one, confirm it still goes red when the property is violated.

## Status

Under active development toward the MVP in spec §7.1. The service is not launched; spec §51 lists the conditions that must be met first, several of which are legal rather than technical.
