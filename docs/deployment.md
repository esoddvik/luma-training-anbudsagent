# Deployment

Operator guide for Luma Anbudsvarsling. Three deployable services, two platforms,
one PostgreSQL database.

> **Never put values in this repository.** This document lists variable *names*
> only. Values live in Vercel project settings, Railway service variables and
> your local `.env` (which is gitignored).

---

## 1. What runs where

| Service     | Path        | Platform | Public URL                                   |
| ----------- | ----------- | -------- | -------------------------------------------- |
| Web         | `apps/web`  | Vercel   | `https://anbudsvarsling.luma-training.com`   |
| Core API    | `apps/core` | Railway  | internal + `https://api.…` (optional)        |
| MCP server  | `apps/mcp`  | Railway  | `https://mcp.luma-training.com/mcp`          |
| PostgreSQL  | —           | Railway  | private network only                         |

`apps/core` is a single Node process that runs the Fastify HTTP API, the pg-boss
worker and the cron jobs (Doffin ingest, digest, cleanup). pg-boss creates its
own `pgboss` schema inside the same PostgreSQL database — there is no separate
queue service. Per spec §46, Doffin ingest must never run as a request-bound
Vercel function.

### Vercel project

Root Directory: `apps/web`. Enable **"Include source files outside of the Root
Directory in the Build Step"** — the build command is
`cd ../.. && pnpm turbo run build --filter=web` and needs the workspace root.
Everything else (framework, install/build command, output dir, region `arn1`,
security headers) is declared in [`apps/web/vercel.json`](../apps/web/vercel.json).

### Railway services

Both Railway services use the **repo root** as their root directory and point at
a config-as-code file inside the app directory. See
[`apps/core/README.md`](../apps/core/README.md) and
[`apps/mcp/README.md`](../apps/mcp/README.md) for the exact settings.

### Package naming and turbo filters

The repo splits naming by kind, and every build command depends on it:

- **Apps are unscoped**: `web`, `core`, `mcp`.
- **Libraries are scoped**: `@luma/auth`, `@luma/config`, `@luma/db`, `@luma/domain`,
  `@luma/email`, `@luma/matching`, `@luma/observability`, `@luma/ui`, `@luma/content`.

So `--filter=web` and `--filter=@luma/ui` are both correct as written.

If an app is ever renamed to `@luma/web`, the filter **silently resolves to zero
packages** — the build succeeds and produces nothing rather than failing. That
is the dangerous failure mode, because a deploy of the previous artifact looks
like a deploy of the new one. If you rename an app, switch to the path form
`--filter=./apps/web`, which matches by directory and is rename-proof, and
change these together: `apps/web/vercel.json`, `apps/core/railway.json`,
`apps/mcp/railway.json`, both `Dockerfile`s and `.github/workflows/e2e.yml`.

### Entrypoints

Both Railway services start a compiled entrypoint directly, with no pnpm or
shell wrapper, so `SIGTERM` reaches the process and the graceful-shutdown
handler in `src/shutdown.ts` actually runs:

| Service | Start command                 | Default port |
| ------- | ----------------------------- | ------------ |
| core    | `node apps/core/dist/main.js` | 8080         |
| mcp     | `node apps/mcp/dist/main.js`  | 8081         |

Railway injects `PORT`; the defaults above apply only to local and Docker runs.
If an entrypoint is ever renamed from `main.ts`, update the `startCommand` in
the matching `railway.json` **and** the `CMD` in the matching `Dockerfile`.

### Containerizing apps/web

`apps/web` builds with `output: 'standalone'` and `outputFileTracingRoot` set to
the workspace root, so the pnpm-linked `@luma/ui` files get traced into the
standalone bundle. That only matters if someone containerizes web the way core
and mcp are containerized — the Vercel path in `vercel.json` does not use it.

---

## 2. Environment variables

Names only. The authoritative list is spec §48 and the Zod schema in
`packages/config`; if the two disagree, the schema wins.

> **`DOFFIN_SUBSCRIPTION_KEY` replaces the spec's `DOFFIN_API_KEY`.** The spec
> was written before the Doffin API's actual auth header was confirmed. Use
> `DOFFIN_SUBSCRIPTION_KEY` everywhere.

### Shared by all three services

```text
NODE_ENV
APP_URL
API_URL
MCP_URL
DATABASE_URL
LUMA_PRIVACY_POLICY_URL
TENDER_SERVICE_TERMS_URL
SENTRY_DSN
```

### apps/web (Vercel)

```text
AUTH_SECRET
AUTH_EMAIL_FROM
SHARE_TOKEN_SECRET
CURRENT_PRIVACY_POLICY_VERSION
CURRENT_TERMS_VERSION
CURRENT_MARKETING_CONSENT_TEXT_VERSION
ANALYTICS_KEY
```

### apps/core (Railway)

```text
AUTH_SECRET
AUTH_EMAIL_FROM
DOFFIN_API_BASE_URL
DOFFIN_SUBSCRIPTION_KEY
DOFFIN_API_CLIENT_ID
DOFFIN_API_CLIENT_SECRET
POSTMARK_SERVER_TOKEN
POSTMARK_ACCOUNT_TOKEN
POSTMARK_TRANSACTIONAL_STREAM
POSTMARK_TENDER_NOTIFICATION_STREAM
POSTMARK_MARKETING_STREAM
POSTMARK_WEBHOOK_USERNAME
POSTMARK_WEBHOOK_PASSWORD
SHARE_TOKEN_SECRET
SHARE_DEFAULT_TTL_DAYS
CURRENT_PRIVACY_POLICY_VERSION
CURRENT_TERMS_VERSION
CURRENT_MARKETING_CONSENT_TEXT_VERSION
BILLING_PROVIDER
BILLING_ADMIN_EMAIL
DEFAULT_VAT_PERCENT
OSLO_REGION_CODES
CRON_SECRET
ADMIN_EMAIL_ALLOWLIST
MCP_TOKEN_PEPPER
REDIS_URL
```

`REDIS_URL` is optional and only needed if rate limiting is moved off in-process
storage. `MCP_TOKEN_PEPPER` is needed here because core mints and revokes MCP
tokens; it must be the **same value** as in `apps/mcp`.

### apps/mcp (Railway)

```text
MCP_TOKEN_PEPPER
```

Only that, plus the shared block. The MCP server hashes incoming bearer tokens
with the pepper and looks them up; it must not have Postmark, Doffin or billing
credentials.

### Rules

- `AUTH_SECRET`, `MCP_TOKEN_PEPPER`, `SHARE_TOKEN_SECRET` and `CRON_SECRET` are
  independent random values, minimum 32 bytes. Never reuse one for another.
- `DATABASE_URL` on Railway should use the private-network host, not the public
  proxy. Vercel has to use the public connection string.
- Rotating `MCP_TOKEN_PEPPER` invalidates every issued MCP token. Rotating
  `SHARE_TOKEN_SECRET` invalidates every live share link.

---

## 3. Running the stack locally

```bash
# 1. PostgreSQL 16 (matches production)
docker compose up -d postgres

# 2. Environment
cp .env.example .env      # then fill in values — .env is gitignored

# 3. Dependencies and schema
pnpm install
pnpm db:migrate

# 4. Everything, with hot reload
pnpm dev
```

`pnpm dev` runs `turbo run dev`, which starts web, core and mcp in parallel.
Default local ports: web `3000`, core `8080`, mcp `8081`.

Useful:

```bash
pnpm db:generate          # generate a migration from schema changes
pnpm db:studio            # Drizzle Studio
docker compose down       # stop postgres (keeps the volume)
docker compose down -v    # stop postgres AND wipe the data volume
```

pg-boss bootstraps its `pgboss` schema on first worker start. You do not create
it, and `pnpm db:migrate` does not manage it.

---

## 4. CI gates

Two workflows, both blocking. Neither uses `continue-on-error`.

### `.github/workflows/ci.yml` — push to `main` and every PR

| Job       | Steps                                                    |
| --------- | -------------------------------------------------------- |
| `quality` | `format:check` → `lint` → `typecheck` → `build`          |
| `test`    | `db:migrate` → `test`, against a `postgres:16` service container |

Both jobs install with `pnpm install --frozen-lockfile`, so **a stale lockfile
fails CI**. Run `pnpm install` and commit `pnpm-lock.yaml` with any dependency
change.

> **Do not reorder the `quality` steps.** `format:check` has to run before
> `typecheck` and `build`. Both `next typegen` and `next build` regenerate
> `apps/web/next-env.d.ts`, and Next writes it with double quotes, which
> prettier rejects under the repo's `singleQuote` config. The file is gitignored
> so it is absent from a fresh checkout — checking formatting first is the only
> reason this passes. The durable fix is a `next-env.d.ts` line in the root
> `.prettierignore`; until that lands, the ordering is load-bearing.
>
> The same applies locally: run `pnpm format:check` before `pnpm build`, or it
> will flag a generated file you did not write.

pnpm is installed by `pnpm/action-setup@v4` with no pinned version — it reads
`packageManager` from the root `package.json`. Bump the version there and CI
follows automatically.

Turbo's local cache (`.turbo`) is cached per lockfile hash + commit sha, with a
lockfile-only and then OS-only restore fallback.

All env vars the Zod schema requires are set at workflow level to obviously fake
values (`test-secret-not-real`). **No real secret is ever referenced in CI.** If
you add a required env var to the schema, add a fake value to both workflows or
every job starts failing at import time.

### `.github/workflows/e2e.yml` — every PR, plus manual `workflow_dispatch`

Playwright against chromium, with the same postgres service. On failure it
uploads the `playwright-report` artifact (7-day retention). Not scheduled on
`main` pushes — run it manually before a production deploy if the PR is old.

### Dependency scanning

`.github/dependabot.yml` (spec §40): weekly, Monday 06:00 Europe/Oslo. npm
updates across the root, `apps/*` and `packages/*` are grouped into one
minor-and-patch PR; majors and security advisories come separately. GitHub
Actions versions are scanned on the same schedule.

---

## 5. DNS

Both records go in the `luma-training.com` zone. Add the domain in the platform
**first**, then create the record — both platforms need to see the record to
issue a certificate, and both will show a verification state until it resolves.

### `anbudsvarsling.luma-training.com` → Vercel

1. Vercel → project → Settings → Domains → add `anbudsvarsling.luma-training.com`.
2. Create the DNS record Vercel shows:

   ```text
   anbudsvarsling   CNAME   cname.vercel-dns.com.   (TTL 300)
   ```

3. Wait for Vercel to report the domain as Valid; the Let's Encrypt certificate
   is issued automatically. HSTS with `preload` is set by `vercel.json`, so do
   not point this hostname anywhere else afterwards without planning for it.

### `mcp.luma-training.com` → Railway

1. Railway → mcp service → Settings → Networking → Custom Domain → add
   `mcp.luma-training.com`.
2. Railway returns a service-specific CNAME target (of the form
   `<something>.up.railway.app`). **Use the value Railway gives you** — it is
   per-service and must not be copied from another project.

   ```text
   mcp   CNAME   <value-from-railway>   (TTL 300)
   ```

3. The MCP endpoint is then `https://mcp.luma-training.com/mcp` (spec §33).
   Verify `https://mcp.luma-training.com/health` returns 200 before announcing it.

Neither hostname is an apex record, so CNAMEs are fine and no ALIAS/ANAME
support is required from the DNS provider.

---

## 6. Deploy order

For a change that touches the database schema:

1. Merge to `main` (CI must be green).
2. Railway deploys `apps/core` — migrations run before the new process serves
   traffic. Watch the health check go green.
3. Railway deploys `apps/mcp`.
4. Vercel deploys `apps/web`.

Schema changes must be backwards-compatible for one release, because web and
core are never swapped atomically. Add columns before you read them; drop
columns a release after you stop writing them.

Rollback: Railway → Deployments → Redeploy the previous build. Vercel →
Deployments → Promote the previous production deployment. Neither reverses a
migration — write a forward fix.
