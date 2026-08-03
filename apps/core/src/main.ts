// Loading the environment must happen before any module reads configuration.
// ES module imports are hoisted, so this side-effecting import is deliberately
// first and configuration is read lazily behind getCoreEnv().
import { loadDotEnv } from '@luma/config';
loadDotEnv();

import { getCoreEnv } from '@luma/config';
import { createLogger } from '@luma/observability';
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

  const app = await buildServer({
    logger,
    allowedOrigins: [env.APP_URL],
    readinessChecks: [],
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
      // Queue and database handles are registered here as they are wired in.
    ],
  });
}

main().catch((error: unknown) => {
  // The logger may not exist yet, so this is the one place a bare console is
  // the right tool: a startup failure must still be visible in platform logs.
  console.error('core service failed to start', error);
  process.exitCode = 1;
});
