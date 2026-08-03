import { describe, expect, it } from 'vitest';
import { createLogger } from '@luma/observability';
import { shutdown, type Closeable } from './shutdown.js';

const silentLogger = createLogger({ service: 'core', silent: true });

function recorder(order: string[], name: string, fail = false): Closeable {
  return {
    name,
    close: async () => {
      order.push(name);
      if (fail) throw new Error(`${name} refused to close`);
    },
  };
}

describe('shutdown', () => {
  it('closes resources in the order given', async () => {
    const order: string[] = [];
    await shutdown({
      logger: silentLogger,
      close: [recorder(order, 'http'), recorder(order, 'queue'), recorder(order, 'database')],
    });

    // Outermost first: HTTP stops accepting work before the queue drains, and
    // the database closes last so in-flight jobs can finish.
    expect(order).toEqual(['http', 'queue', 'database']);
  });

  it('exits zero when everything closes cleanly', async () => {
    const code = await shutdown({ logger: silentLogger, close: [recorder([], 'http')] });
    expect(code).toBe(0);
  });

  it('still closes later resources when an earlier one fails', async () => {
    const order: string[] = [];
    await shutdown({
      logger: silentLogger,
      close: [recorder(order, 'http', true), recorder(order, 'database')],
    });

    // A failure closing the HTTP server must not strand an open database pool.
    expect(order).toEqual(['http', 'database']);
  });

  it('exits non-zero when a resource fails to close', async () => {
    const code = await shutdown({
      logger: silentLogger,
      close: [recorder([], 'database', true)],
    });
    expect(code).toBe(1);
  });

  it('is a no-op with nothing registered', async () => {
    expect(await shutdown({ logger: silentLogger, close: [] })).toBe(0);
  });
});
