import { describe, expect, it } from 'vitest';
import { Writable } from 'node:stream';
import pino from 'pino';
import { createLogger, getCorrelationId, withCorrelationId } from './logger.js';
import { redactPaths, scrubSecrets } from './redaction.js';

/** Collects the JSON lines a logger writes so assertions inspect real output. */
function captureLogger() {
  const lines: Array<Record<string, unknown>> = [];
  const stream = new Writable({
    write(chunk, _encoding, callback) {
      lines.push(JSON.parse(String(chunk)));
      callback();
    },
  });
  const logger = pino(
    {
      base: { service: 'test' },
      redact: { paths: [...redactPaths], censor: '[redacted]' },
      hooks: {
        logMethod(args, method) {
          const scrubbed = args.map((arg) =>
            typeof arg === 'string' ? scrubSecrets(arg) : arg,
          );
          return method.apply(this, scrubbed as Parameters<typeof method>);
        },
      },
    },
    stream,
  );
  return { logger, lines };
}

describe('createLogger', () => {
  it('tags every line with the service name', () => {
    const logger = createLogger({ service: 'core' });
    expect(logger.bindings().service).toBe('core');
  });

  it('honours the requested level', () => {
    expect(createLogger({ service: 'core', level: 'debug' }).level).toBe('debug');
  });
});

describe('log output redaction', () => {
  it('removes a token passed as a structured field', () => {
    const { logger, lines } = captureLogger();
    logger.info({ token: 'lum_live_supersecretvalue' }, 'token issued');
    expect(JSON.stringify(lines[0])).not.toContain('supersecretvalue');
    expect(lines[0]?.token).toBe('[redacted]');
  });

  it('removes an authorization header carried on a request object', () => {
    const { logger, lines } = captureLogger();
    logger.info({ req: { headers: { authorization: 'Bearer lum_live_abcdefgh' } } }, 'request');
    expect(JSON.stringify(lines[0])).not.toContain('abcdefgh');
  });

  it('scrubs a magic link that reached the message string', () => {
    const { logger, lines } = captureLogger();
    logger.info('sending https://example.com/logg-inn?token=abcdef0123456789abcdef');
    expect(lines[0]?.msg).not.toContain('abcdef0123456789abcdef');
  });

  it('masks an email address in the message string', () => {
    const { logger, lines } = captureLogger();
    logger.warn('bounce for espen@luma-training.com');
    expect(lines[0]?.msg).toBe('bounce for e***@luma-training.com');
  });
});

describe('correlation ids', () => {
  it('exposes the id inside the wrapped call', () => {
    withCorrelationId('corr-1', () => {
      expect(getCorrelationId()).toBe('corr-1');
    });
  });

  it('generates an id when the caller has none', () => {
    withCorrelationId(undefined, () => {
      expect(getCorrelationId()).toMatch(/^[0-9a-f-]{36}$/);
    });
  });

  it('is undefined outside any wrapped call', () => {
    expect(getCorrelationId()).toBeUndefined();
  });

  it('survives an await boundary', async () => {
    await withCorrelationId('corr-2', async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      expect(getCorrelationId()).toBe('corr-2');
    });
  });

  it('keeps concurrent operations isolated from each other', async () => {
    const seen: Array<string | undefined> = [];
    await Promise.all([
      withCorrelationId('a', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        seen.push(getCorrelationId());
      }),
      withCorrelationId('b', async () => {
        seen.push(getCorrelationId());
      }),
    ]);
    expect(seen.sort()).toEqual(['a', 'b']);
  });

  it('attaches the correlation id to emitted lines', () => {
    const { logger, lines } = captureLogger();
    withCorrelationId('corr-3', () => {
      logger.child({ correlationId: 'corr-3' }).info('work');
    });
    expect(lines[0]?.correlationId).toBe('corr-3');
  });
});
