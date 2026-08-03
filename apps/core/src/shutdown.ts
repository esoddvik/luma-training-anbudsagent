import type { Logger } from '@luma/observability';

/**
 * Graceful shutdown (spec section 38: graceful shutdown, close database
 * connections, no duplicate emails).
 *
 * Resources close in the order given, which must be outermost first: stop
 * accepting HTTP requests, then let the queue drain, then close the database.
 * Closing the database first would fail every in-flight job and, with
 * at-least-once delivery, cause the work to be retried — which for the email
 * jobs means a real risk of sending twice.
 */

export interface Closeable {
  name: string;
  close: () => Promise<unknown>;
}

export interface ShutdownOptions {
  logger: Logger;
  close: readonly Closeable[];
  /** After this long, the process exits even if a resource is still closing. */
  timeoutMs?: number;
  /** Injectable for tests. */
  exit?: (code: number) => void;
  signals?: readonly NodeJS.Signals[];
}

const DEFAULT_TIMEOUT_MS = 15_000;

export async function shutdown(options: ShutdownOptions): Promise<number> {
  const { logger, close } = options;
  let exitCode = 0;

  for (const resource of close) {
    try {
      await resource.close();
      logger.info({ resource: resource.name }, 'closed cleanly');
    } catch (error) {
      // Keep going: a failure closing one resource must not strand the others.
      logger.error({ err: error, resource: resource.name }, 'failed to close cleanly');
      exitCode = 1;
    }
  }

  return exitCode;
}

export function installShutdownHandlers(options: ShutdownOptions): void {
  const { logger, timeoutMs = DEFAULT_TIMEOUT_MS, exit = (code) => process.exit(code) } = options;
  const signals = options.signals ?? (['SIGTERM', 'SIGINT'] as const);
  let shuttingDown = false;

  for (const signal of signals) {
    process.on(signal, () => {
      if (shuttingDown) {
        // A second signal means the operator wants out now.
        logger.warn({ signal }, 'second shutdown signal, exiting immediately');
        exit(1);
        return;
      }
      shuttingDown = true;
      logger.info({ signal }, 'shutting down');

      const forceExit = setTimeout(() => {
        logger.error({ timeoutMs }, 'shutdown timed out, forcing exit');
        exit(1);
      }, timeoutMs);
      forceExit.unref();

      void shutdown(options).then((code) => {
        clearTimeout(forceExit);
        exit(code);
      });
    });
  }
}
