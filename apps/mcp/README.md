# @luma/mcp — deployment notes

MCP Streamable HTTP server, deployed to **Railway** and served on
`https://mcp.luma-training.com/mcp`.

## Railway service configuration

> **The Railway service root directory must be the repo root, not `apps/mcp`.**
> This is a monorepo build: the pnpm workspace, the lockfile and the shared
> `packages/*` all live at the repo root, and `pnpm turbo run build --filter=mcp...`
> only resolves from there. Setting the root directory to `apps/mcp` breaks the
> install because the lockfile and workspace manifest are not in that directory.

Set in the Railway service settings:

| Setting          | Value                         |
| ---------------- | ----------------------------- |
| Root Directory   | `/` (repo root)               |
| Config-as-code   | `apps/mcp/railway.json`       |
| Watch Paths      | `apps/mcp/**`, `packages/**`, `pnpm-lock.yaml`, `turbo.json` |

Everything else — builder, build command, start command, health check and
restart policy — is declared in [`railway.json`](./railway.json) and should not
be duplicated in the dashboard.

## Health check

The service must expose `GET /health` (liveness) and `GET /ready` (readiness,
includes a DB ping), separate from the `/mcp` Streamable HTTP endpoint. Railway
probes `/health` with a 60 s timeout; the container is restarted `ON_FAILURE`
up to 10 times.

Note that `/health` must stay unauthenticated while `/mcp` enforces bearer-token
auth and the host allowlist (spec §40).

## Docker alternative

[`Dockerfile`](./Dockerfile) is a multi-stage alternative to the Nixpacks build.
Build it **from the repo root**:

```bash
docker build -f apps/mcp/Dockerfile -t luma-mcp .
```

Use either Nixpacks (`railway.json`) or the Dockerfile — not both. If you switch
Railway to the Dockerfile builder, point it at `apps/mcp/Dockerfile` and keep
the root directory at the repo root so the build context stays correct.

## Environment variables

See [`docs/deployment.md`](../../docs/deployment.md) for the per-service list.
Never commit values.
