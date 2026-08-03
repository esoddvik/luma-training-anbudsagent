import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import pino, { type Logger, type LoggerOptions } from 'pino';
import { redactPaths, scrubSecrets } from './redaction.js';

export type { Logger };

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface CreateLoggerOptions {
  /** Service name, emitted on every line so logs from all three apps merge. */
  service: 'web' | 'core' | 'mcp' | 'worker' | string;
  level?: LogLevel;
  /** Human-readable output for local development. Never enable in production. */
  pretty?: boolean;
  /** Discards all output. For tests, so a suite is not drowned in log lines. */
  silent?: boolean;
}

interface RequestContext {
  correlationId: string;
  userId?: string;
}

const contextStorage = new AsyncLocalStorage<RequestContext>();

/**
 * Runs `fn` with a correlation id attached to every log line it produces,
 * including lines from nested async work. Generates an id when none is
 * supplied, so an inbound request header can be honoured when present.
 */
export function withCorrelationId<T>(
  correlationId: string | undefined,
  fn: () => T,
  userId?: string,
): T {
  return contextStorage.run({ correlationId: correlationId ?? randomUUID(), userId }, fn);
}

export function getCorrelationId(): string | undefined {
  return contextStorage.getStore()?.correlationId;
}

export function newCorrelationId(): string {
  return randomUUID();
}

export function createLogger(options: CreateLoggerOptions): Logger {
  const config: LoggerOptions = {
    level: options.level ?? 'info',
    base: { service: options.service },
    redact: { paths: [...redactPaths], censor: '[redacted]' },
    // Every message passes through the scrubber, because a token can reach a
    // log line inside an error string from a dependency we do not control.
    hooks: {
      logMethod(args, method) {
        const scrubbed = args.map((arg) => (typeof arg === 'string' ? scrubSecrets(arg) : arg));
        return method.apply(this, scrubbed as Parameters<typeof method>);
      },
    },
    mixin() {
      const store = contextStorage.getStore();
      if (!store) return {};
      return store.userId
        ? { correlationId: store.correlationId, userId: store.userId }
        : { correlationId: store.correlationId };
    },
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
  };

  if (options.silent) {
    return pino({ ...config, level: 'silent' });
  }

  if (options.pretty) {
    return pino({
      ...config,
      transport: { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } },
    });
  }

  return pino(config);
}
