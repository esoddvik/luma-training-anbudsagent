# Deployment

Operator guide for Luma Anbudsvarsling. Three deployable services, two platforms,
one PostgreSQL database.

> **Never put values in this repository.** This document lists variable *names*
> only. Values live in Vercel project settings, Railway service variables and
> your local `.env` (which is gitignored).

---

## 1. What runs where

| Service     | Path        | Platform | Public URL                                       |
| ----------- | ----------- | -------- | ------------------------------------------------ |
| Web         | `apps/web`  | Vercel   | `https://luma-training.com/anbudsvarsling`       |
| Core API    | `apps/core` | Railway  | internal + `https://api.…` (optional)            |
| MCP server  | `apps/mcp`  | Railway  | `https://mcp.luma-training.com/mcp`              |
| PostgreSQL  | —           | Railway  | private network only                             |

**Web is served under a path, not on a subdomain.** It is a Next.js Multi Zone
with `basePath: '/anbudsvarsling'`, reached through a rewrite on Luma Training's
marketing site — a **separate repository** this one never edits. §7 below holds
the rewrite that site needs. Nothing here deploys until that rewrite is in
place: the Vercel deployment is reachable on its own `*.vercel.app` hostname,
but the public URL is the one in the table.

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

> **`vercel.json`'s `headers[].source` values must carry the base path.** Vercel
> matches `source` against the request path as it arrives, and with
> `basePath: '/anbudsvarsling'` every request to this app arrives prefixed. The
> `X-Robots-Tag: noindex, nofollow, noarchive` that spec §17 requires on the
> shared view is therefore sourced at `/anbudsvarsling/delt/:path*`, and a
> second entry for the unprefixed `/delt/:path*` was removed because it can no
> longer match anything. `vercel.json` is strict JSON — it accepts neither
> comments nor a `$comment` key — so this note lives here and beside `basePath`
> in `apps/web/next.config.ts`. If the prefix ever moves, move that source with
> it: a share page that stops matching becomes an indexable private page, and
> nothing fails.

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

> **`APP_URL` must include `/anbudsvarsling`** — in production
> `https://luma-training.com/anbudsvarsling`, locally
> `http://localhost:3000/anbudsvarsling`. It is the only place the base path
> exists outside `apps/web`: `apps/core` builds magic links, share links and
> every email footer link from `APP_URL` and has no idea Next has a `basePath`.
> Set it without the path and every login link points at the marketing site's
> 404 page. The URL parses, the host is right, the mail sends, nothing is
> logged, and nobody can sign in. `packages/email`'s `links.test.ts` fails if
> the join ever stops preserving the path, but nothing can check the value you
> type into a platform's settings page.
>
> `TENDER_SERVICE_TERMS_URL` points at a page this app serves, so it carries the
> prefix too.
>
> `apps/core` derives its CSRF and CORS origin list from `APP_URL` with
> `new URL(APP_URL).origin`, because an `Origin` header never carries a path.

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

| Job       | Steps                                                            |
| --------- | ---------------------------------------------------------------- |
| `quality` | `format:check` → `lint` → `typecheck` → `build`                  |
| `test`    | `db:migrate` → `test`, against a `postgres:16` service container |

> **The `test` job's database is load-bearing, and the failure mode is silent.**
> The integration suites skip themselves when `DATABASE_URL` is absent, so a
> `test` job without a database does not fail — it passes, having verified
> nothing about cross-user isolation, the shared-view leak, consent
> immutability (ADR-9), attribution isolation (ADR-6) or account deletion (§40).
>
> `packages/db/src/testing/harness.ts` guards against this: it throws at import
> time when `CI` is set and `DATABASE_URL` is not. So the pipeline now fails
> loudly for the right reason. The trap is that deleting the `DATABASE_URL` env
> entry or the `services.postgres` block is the quickest way to make that red
> build green — and it restores the exact silent-success the guard was added to
> prevent. If the `test` job goes red for a missing database, fix the database.
>
> Note also that the guard reads `CI` as a flag: `''`, `'0'` and `'false'` all
> count as "not CI". `CI: 'false'` is the documented way to stop a Next build
> treating warnings as errors, so setting it on a job disarms the guard there
> too. Harmless for `quality`, which runs no integration tests — worth checking
> before adding a third job.

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

### `luma-training.com` → unchanged

The apex record already points at the marketing site and **must not be
repointed**. `apps/web` is reached through that site's rewrite (§7), not through
a DNS record of its own, which is the whole point of moving off a subdomain:
the service inherits the domain's existing SEO standing instead of starting a
new hostname from zero.

The Vercel project still needs a hostname to be rewritten *to*. Either leave it
on the generated `<project>.vercel.app` name or give it an internal one; nothing
links to it, and §7's rewrite is what the public sees. HSTS with `preload` is
set by `vercel.json` and is now served under `luma-training.com`, so the header
applies to the apex — confirm the marketing site is happy with `preload` before
launch, because it is a hard commitment to HTTPS for the whole domain.

### `mcp.luma-training.com` → Railway

This one record does go in the `luma-training.com` zone. Add the domain in
Railway **first**, then create the record — the platform needs to see it to
issue a certificate, and will show a verification state until it resolves.

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

`mcp.luma-training.com` is not an apex record, so a CNAME is fine and no
ALIAS/ANAME support is required from the DNS provider.

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

---

## 7. The rewrite the marketing site needs

`luma-training.com` is served by a **separate repository** — `C:\Luma Training
web` on the machine this was written on. Nothing in this repository edits it.
This section exists so that whoever owns it can paste the change in and know
what it is for.

Without this rewrite `luma-training.com/anbudsvarsling` is a 404 on the
marketing site and this service is only reachable on its raw Vercel hostname.

### What to add

> **This is now live, and the marketing site named the variable
> `ANBUDSVARSLING_ZONE_URL`.** The snippet below still reads
> `ANBUDSVARSLING_ORIGIN` because that is what this document proposed; the
> implementation is the authority. It also gates the whole `rewrites()` array on
> the variable being set (`if (!zone) return []`), so that an unset variable
> leaves the marketing site untouched rather than pointing `/anbudsvarsling/*`
> at `undefined`. Read the real file before changing anything here.

In the marketing site's `next.config.js` (or `.ts`):

```js
/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [
      // Luma Anbudsvarsling is a separate Next.js app (a Multi Zone) deployed
      // to Vercel with basePath: '/anbudsvarsling'. Both entries are needed:
      // the first is the landing page itself, the second is everything under
      // it. `:path+` requires at least one segment and will not match the bare
      // prefix, which is why the bare prefix has its own rule.
      {
        source: '/anbudsvarsling',
        destination: `${process.env.ANBUDSVARSLING_ORIGIN}/anbudsvarsling`,
      },
      {
        source: '/anbudsvarsling/:path+',
        destination: `${process.env.ANBUDSVARSLING_ORIGIN}/anbudsvarsling/:path+`,
      },
    ];
  },
};

module.exports = nextConfig;
```

`ANBUDSVARSLING_ORIGIN` is the anbudsvarsling app's own deployment origin,
scheme and host, no trailing slash — for example
`https://luma-anbudsvarsling.vercel.app`. Set it as an environment variable on
the marketing site's project rather than hard-coding it, so a preview
deployment can be pointed at a preview of this app.

> **Give it the project alias, never a per-deployment URL.**
> `https://luma-anbudsvarsling.vercel.app` follows every production deploy of
> this app. A URL of the form
> `https://luma-anbudsvarsling-<hash>-<team>.vercel.app` is immutable and pinned
> to one build forever, so the zone silently freezes: this repo keeps deploying
> green, and `luma-training.com/anbudsvarsling` keeps serving whatever was built
> the day the variable was set. That is exactly what happened on 2026-08-06, and
> it cost an afternoon before anyone looked at the rewrite.

#### Setting it on Vercel, in the order that works

`rewrites()` is evaluated **at build time**, not per request. Three consequences,
each of which has already wasted someone's time:

- **The value only takes effect on the next build.** Saving the variable changes
  nothing on its own. Redeploy the marketing site afterwards.
- **What the dashboard shows is the value for the *next* build, not the one
  serving traffic.** A blank field with a working `/anbudsvarsling` means a
  previous build baked a value that is still routing. Do not read the field as
  the live state.
- **Purging the CDN does nothing.** The route lives in the deployment's routing
  manifest, not in a cache. If a stale zone survives a purge and a marketing-site
  redeploy, the destination is wrong — stop purging and go read the variable.

Add it as a **plain, non-sensitive** variable with **Production** ticked. Vercel
hides a sensitive variable's value after saving, so a sensitive one cannot be
read back to confirm what it holds — which turns the point above into a dead end,
because a blank field is then indistinguishable from an unset one. Nothing here
is a secret: it is a public hostname.

**To confirm the zone is actually live**, ask for a URL that has never existed:

```bash
curl -s "https://www.luma-training.com/anbudsvarsling/probe-$RANDOM" | grep -oE 'dpl_[A-Za-z0-9]+'
```

Nothing can serve a brand-new path from cache, so the `dpl_…` that comes back is
the deployment the rewrite genuinely resolves to. Compare it against the one on
`https://luma-anbudsvarsling.vercel.app/anbudsvarsling`. Comparing rendered
markup instead is unreliable — two builds share most asset filenames, and an
asset that 200s through the marketing site may simply exist in both.

### Why there is no third rule for static assets

The Multi Zones guide shows a third rewrite for an `assetPrefix` path, and one
for `/_next/…`. Neither applies here:

- This app sets **`basePath` and no `assetPrefix`**, so Next already serves its
  own JS and CSS from `/anbudsvarsling/_next/…`. That is inside
  `/anbudsvarsling/:path+`, so the rule above already carries it. Verified
  against the running app: every `<script src>` and the `next/image` URL are
  prefixed.
- The guide's extra `/blog-static/_next/:path+` rewrite is for Next versions
  before 15 and is called out in the docs as no longer necessary.

Adding an `assetPrefix` to this app **would** require a third rule, and would
buy nothing — the prefix already namespaces the assets against the marketing
site's own `/_next/…`.

### The second thing the marketing site owes us: `robots.txt`

**Raised now because it has lead time**, and it is not something this
repository can fix on the day the search-first pages launch.

`robots.txt` is only ever read from the **origin root** — `/robots.txt`. A
crawler never looks at `/anbudsvarsling/robots.txt`, so a file generated by
this app cannot be seen, whatever Next puts there. The marketing site owns the
root, so the marketing site owns the file, and its current contents were
written without knowing this app exists.

Two things it needs, and the sitemap line is the load-bearing one:

```
Sitemap: https://www.luma-training.com/anbudsvarsling/sitemap.xml

Disallow: /anbudsvarsling/delt/
Disallow: /anbudsvarsling/registrering/
```

- The **`Sitemap:` line** is how a crawler finds `app/sitemap.ts` at all.
  Without it the public trade and notice pages are discoverable only by
  following links, which for a brand-new section of a site is slow enough to
  look like the pages do not work.
- The two **`Disallow:` lines** are belt to the `X-Robots-Tag` braces already
  set in `apps/web/vercel.json`. The header is what actually keeps those paths
  out of an index — `Disallow` prevents *crawling*, not indexing, and a
  disallowed URL can still be indexed from an inbound link. Both, because a
  share token or a confirmation link in search results is the kind of mistake
  that cannot be taken back.

Do **not** add `Disallow: /anbudsvarsling/` wholesale. That would block the
pages the whole search-first funnel exists to get indexed.

### What breaks if the rewrite is wrong

- **A rewrite that strips the prefix** — `destination: '${ORIGIN}/:path+'` —
  makes every page load with unstyled HTML and no interactivity. The document
  renders; the asset URLs 404 against a `basePath`ed server.
- **A redirect instead of a rewrite** exposes the Vercel hostname in the address
  bar, which loses the SEO benefit the move was made for and puts the session
  cookie on the wrong host.
- **`:path*` instead of `:path+`** on the second rule with the first rule
  removed can send `/anbudsvarsling` itself to `${ORIGIN}/anbudsvarsling/`,
  which is a redirect hop rather than the page.

### One check that catches all three

After deploying the rewrite, from anywhere:

```bash
curl -sI https://luma-training.com/anbudsvarsling | head -1        # 200, not 301/404
curl -s  https://luma-training.com/anbudsvarsling | grep -o '/anbudsvarsling/_next/static/[^"]*' | head -1
curl -sI "https://luma-training.com$(curl -s https://luma-training.com/anbudsvarsling \
  | grep -o '/anbudsvarsling/_next/static/[^"]*' | head -1)" | head -1   # 200
```

The third line is the one that matters: it asks for an asset by the URL the
page itself printed. A page that renders while its assets 404 looks broken but
reports nothing, and is the failure this whole section is about.

### Server Actions

`apps/web` lists `luma-training.com` in
`experimental.serverActions.allowedOrigins`. Server Actions refuse a request
whose `Origin` does not match the `Host` they were served on, and behind a
rewrite those never match. If the public hostname ever changes, that list has to
change with it or every form on the service — the login form first — starts
failing with a CSRF error that mentions neither the proxy nor the origin.
