// Loading the environment must happen before any module reads configuration.
// ES module imports are hoisted, so this side-effecting import is deliberately
// first and configuration is read lazily behind getCoreEnv().
import { loadDotEnv } from '@luma/config';
loadDotEnv();

import { getCoreEnv } from '@luma/config';
import { createDatabase, databaseDependencyCheck } from '@luma/db';
import { DoffinApiAdapter } from '@luma/doffin';
import { createEmailClientFromEnv } from '@luma/email';
import { createLogger } from '@luma/observability';
import { runIngest } from './jobs/ingest.js';
import { runMatching } from './jobs/match.js';
import { apiConfigFromEnv, buildApiContext } from './services/api-context.js';
import { buildServer } from './server.js';
import { installShutdownHandlers } from './shutdown.js';

const DEFAULT_PORT = 8080;

async function main(): Promise<void> {
  const env = getCoreEnv();
  const logger = createLogger({
    service: 'core',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });

  const database = createDatabase({ connectionString: env.DATABASE_URL });
  const email = createEmailClientFromEnv({ logger });

  // The live Doffin adapter is constructed here and reaches the API only
  // through the `JobRunner` seam, so nothing under `routes/` or `services/`
  // has an import edge to it.
  const adapter = new DoffinApiAdapter({
    baseUrl: env.DOFFIN_API_BASE_URL,
    subscriptionKey: env.DOFFIN_SUBSCRIPTION_KEY,
  });

  const api = buildApiContext({
    db: database.db,
    email,
    logger,
    config: apiConfigFromEnv(env),
    jobs: {
      runIngest: async ({ adminUserId }) =>
        runIngest({
          db: database.db,
          adapter,
          logger,
          now: new Date(),
          triggeredByAdminId: adminUserId,
        }),
      runMatching: async (input) =>
        runMatching({
          db: database.db,
          logger,
          now: new Date(),
          ...(input.tenderIds ? { tenderIds: input.tenderIds } : {}),
          ...(input.alertProfileId ? { alertProfileId: input.alertProfileId } : {}),
        }),
    },
  });

  const app = await buildServer({
    logger,
    allowedOrigins: [env.APP_URL],
    readinessChecks: [databaseDependencyCheck(database.db)],
    api,
  });

  // Railway injects PORT; the default matters only for local runs and Docker.
  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  await app.listen({ port, host: '0.0.0.0' });
  logger.info({ port }, 'core service listening');

  installShutdownHandlers({
    logger,
    // Ordered: stop accepting requests, then drain the queue, then close the
    // database. Reversing this would abandon in-flight work.
    close: [
      { name: 'http', close: () => app.close() },
      // The queue handle is registered here as it is wired in.
      { name: 'database', close: () => database.close() },
    ],
  });
}

main().catch((error: unknown) => {
  // The logger may not exist yet, so this is the one place a bare console is
  // the right tool: a startup failure must still be visible in platform logs.
  console.error('core service failed to start', error);
  process.exitCode = 1;
});
