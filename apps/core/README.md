# @luma/core — deployment notes

Fastify HTTP API + pg-boss worker + cron jobs. One Node process, deployed to **Railway**.

## Railway service configuration

> **The Railway service root directory must be the repo root, not `apps/core`.**
> This is a monorepo build: the pnpm workspace, the lockfile and the shared
> `packages/*` all live at the repo root, and `pnpm turbo run build --filter=core...`
> only resolves from there. Setting the root directory to `apps/core` breaks the
> install because the lockfile and workspace manifest are not in that directory.

Set in the Railway service settings:

| Setting          | Value                          |
| ---------------- | ------------------------------ |
| Root Directory   | `/` (repo root)                |
| Config-as-code   | `apps/core/railway.json`       |
| Watch Paths      | `apps/core/**`, `packages/**`, `pnpm-lock.yaml`, `turbo.json` |

Everything else — builder, build command, start command, health check and
restart policy — is declared in [`railway.json`](./railway.json) and should not
be duplicated in the dashboard.

## Health check

The service must expose `GET /health` (liveness) and `GET /ready` (readiness,
includes a DB ping). Railway probes `/health` with a 60 s timeout; the container
is restarted `ON_FAILURE` up to 10 times.

## Docker alternative

[`Dockerfile`](./Dockerfile) is a multi-stage alternative to the Nixpacks build.
Build it **from the repo root**:

```bash
docker build -f apps/core/Dockerfile -t luma-core .
```

Use either Nixpacks (`railway.json`) or the Dockerfile — not both. If you switch
Railway to the Dockerfile builder, point it at `apps/core/Dockerfile` and keep
the root directory at the repo root so the build context stays correct.

## Environment variables

See [`docs/deployment.md`](../../docs/deployment.md) for the per-service list.
Never commit values.
