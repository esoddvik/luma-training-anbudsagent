# syntax=docker/dockerfile:1
#
# apps/mcp — MCP Streamable HTTP server.
#
# BUILD CONTEXT MUST BE THE REPO ROOT (monorepo build):
#   docker build -f apps/mcp/Dockerfile -t luma-mcp .
#
# This is the alternative to the Nixpacks build described in apps/mcp/railway.json.
# Use one or the other, not both.

# ---------------------------------------------------------------------------
# base — Node 22 + pnpm via corepack (version comes from `packageManager`)
# ---------------------------------------------------------------------------
FROM node:22-alpine AS base
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
ENV TURBO_TELEMETRY_DISABLED=1
ENV DO_NOT_TRACK=1
RUN corepack enable
WORKDIR /app

# ---------------------------------------------------------------------------
# deps — warm the pnpm store from the lockfile only, so this layer is reused
#        on every build where the lockfile did not change
# ---------------------------------------------------------------------------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY package.json ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# ---------------------------------------------------------------------------
# build — install offline from the warmed store, then build only mcp + its deps
# ---------------------------------------------------------------------------
FROM deps AS build
COPY . .
RUN pnpm install --frozen-lockfile --offline
RUN pnpm turbo run build --filter=mcp...
# `--legacy` produces a classic node_modules layout, which is what a plain
# `node dist/main.js` runtime needs. `--prod` drops devDependencies.
RUN pnpm deploy --legacy --filter=mcp --prod /prod/mcp

# ---------------------------------------------------------------------------
# runtime — slim, non-root
# ---------------------------------------------------------------------------
FROM base AS runtime
ENV NODE_ENV=production
ENV PORT=8081
WORKDIR /app
COPY --from=build --chown=node:node /prod/mcp ./
USER node
EXPOSE 8081
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8081)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/main.js"]
