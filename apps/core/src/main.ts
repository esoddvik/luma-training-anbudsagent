// Loading the environment must happen before any module reads configuration.
// ES module imports are hoisted, so this side-effecting import is deliberately
// first and configuration is read lazily behind getCoreEnv().
import { loadDotEnv } from '@luma/config';
loadDotEnv();

import { getCoreEnv } from '@luma/config';
import {
  checkSchemaDrift,
  createDatabase,
  databaseDependencyCheck,
  schemaDriftDependencyCheck,
} from '@luma/db';
import { DoffinApiAdapter } from '@luma/doffin';
import { createEmailClientFromEnv } from '@luma/email';
import { createLogger } from '@luma/observability';
import { runBackfill } from './jobs/backfill.js';
import { runIngest } from './jobs/ingest.js';
import { runMatching } from './jobs/match.js';
import { queueDependencyCheck, queueStatus, registerJobs, startQueue } from './queue/index.js';
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

  // The queue starts after the database because pg-boss migrates its own
  // schema into the same database on start (ADR-8), and before the HTTP
  // listener because `/ready` probes it.
  const queue = await startQueue({
    connectionString: env.DATABASE_URL,
    logger,
    worker: env.WORKER_ENABLED,
  });

  await registerJobs({
    boss: queue.boss,
    db: database.db,
    adapter,
    emailClient: email,
    logger,
    worker: queue.worker,
    config: {
      appUrl: env.APP_URL,
      privacyUrl: env.LUMA_PRIVACY_POLICY_URL,
      termsUrl: env.TENDER_SERVICE_TERMS_URL,
      senderName: env.SENDER_NAME,
      senderPostalAddress: env.SENDER_POSTAL_ADDRESS,
      senderContactEmail: env.SENDER_CONTACT_EMAIL,
      osloRegionCodes: env.OSLO_REGION_CODES,
      // Signs on-demand revalidation calls to the web app. Shared with the
      // cron authentication because both answer the same question — "is this
      // the estate talking to itself" — and a second secret would be a second
      // thing to rotate.
      revalidateSecret: env.CRON_SECRET,
    },
  });

  const api = buildApiContext({
    db: database.db,
    email,
    logger,
    config: apiConfigFromEnv(env),
    // A read-only view of queue depth for the admin dashboard (§45). The
    // `PgBoss` handle deliberately does not cross into `ApiContext`: the HTTP
    // layer should be able to observe the queue, not drain it.
    queue: { status: () => queueStatus(queue.boss) },
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
      runBackfill: async ({ days }) =>
        runBackfill({
          db: database.db,
          adapter,
          logger,
          from: new Date(Date.now() - days * 86_400_000),
        }),
    },
  });

  const app = await buildServer({
    logger,
    // The **origin** of `APP_URL`, not `APP_URL` itself. This list is compared
    // against the browser's `Origin` header (and handed to CORS), and an
    // `Origin` is scheme, host and port with no path — ever. Since the web app
    // moved under `luma-training.com/anbudsvarsling`, `APP_URL` carries a path,
    // and passing it raw would make the comparison in `checkCsrf` unsatisfiable:
    // every state-changing browser request would be refused as
    // `csrf_origin_rejected`, and every CORS preflight would fail, on a value
    // that looks correct in the config.
    allowedOrigins: [new URL(env.APP_URL).origin],
    readinessChecks: [
      databaseDependencyCheck(database.db),
      queueDependencyCheck(queue.boss),
      // Proves the schema is not behind the code. A PostgreSQL check alone
      // passed through the whole of the 2026-08-09 outage, where the service
      // was healthy by every measure and signing up threw because three
      // migrations had never run. See `schema-drift.ts`.
      schemaDriftDependencyCheck(database.db),
    ],
    api,
  });

  /*
   * Say it at boot, not only on `/ready`.
   *
   * Readiness is pull-only: it answers when something asks, and after a deploy
   * nothing asks except the platform's own health probe, which is satisfied by
   * a 200. On 2026-08-09 the service booted against a schema three migrations
   * behind and reported itself healthy for hours. A line in the deploy log is
   * what an operator actually sees.
   *
   * Never fatal. A pending migration breaks some features and leaves the
   * ingest pipeline, the digests and every existing surface working; refusing
   * to start would turn a partial outage into a total one.
   */
  const drift = await checkSchemaDrift(database.db).catch(() => null);
  if (drift === null) {
    logger.warn('could not determine whether the database schema is current');
  } else if (drift.state === 'behind') {
    logger.error(
      { shipped: drift.shipped, applied: drift.applied },
      'DATABASE SCHEMA IS BEHIND THIS BUILD — migrations have not been applied. ' +
        'Features depending on new tables will fail. Run `pnpm db:migrate`.',
    );
  } else if (drift.state === 'ahead') {
    logger.warn(
      { shipped: drift.shipped, applied: drift.applied },
      'database schema is ahead of this build, which is what a rollback looks like',
    );
  } else {
    logger.info({ migrations: drift.applied }, 'database schema is current');
  }

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
      // Between HTTP and the database, and it has to be exactly here: closing
      // the pool first would fail every in-flight handler, and at-least-once
      // delivery would then retry work that may already have sent an email.
      { name: 'queue', close: () => queue.close() },
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
