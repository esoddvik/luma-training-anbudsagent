import { afterEach, describe, expect, it } from 'vitest';
import { createLogger, type DependencyCheck } from '@luma/observability';
import { buildServer } from './server.js';

const silentLogger = createLogger({ service: 'core', silent: true });

let app: Awaited<ReturnType<typeof buildServer>> | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function start(readinessChecks: readonly DependencyCheck[] = []) {
  app = await buildServer({
    logger: silentLogger,
    allowedOrigins: ['https://luma-training.com'],
    readinessChecks,
  });
  return app;
}

describe('GET /health', () => {
  it('reports liveness without consulting dependencies', async () => {
    const server = await start([{ name: 'database', probe: async () => false }]);
    const response = await server.inject({ method: 'GET', url: '/health' });

    // The decisive property: a dead database must not make the platform
    // restart an otherwise healthy process.
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ status: 'ok', service: 'core' });
  });
});

describe('GET /ready', () => {
  it('is 200 with no dependencies registered', async () => {
    const server = await start();
    expect((await server.inject({ method: 'GET', url: '/ready' })).statusCode).toBe(200);
  });

  it('is 200 when every dependency passes', async () => {
    const server = await start([{ name: 'database', probe: async () => true }]);
    const response = await server.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('ok');
  });

  it('is 503 when a critical dependency fails', async () => {
    const server = await start([{ name: 'database', probe: async () => false }]);
    const response = await server.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json().checks[0]).toMatchObject({ name: 'database', status: 'failed' });
  });

  it('stays in rotation when only a non-critical dependency is down', async () => {
    const server = await start([
      { name: 'database', probe: async () => true },
      { name: 'postmark', critical: false, probe: async () => false },
    ]);
    const response = await server.inject({ method: 'GET', url: '/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe('degraded');
  });
});

describe('correlation ids', () => {
  it('echoes a supplied correlation id', async () => {
    const server = await start();
    const response = await server.inject({
      method: 'GET',
      url: '/health',
      headers: { 'x-correlation-id': 'from-caller' },
    });
    expect(response.headers['x-correlation-id']).toBe('from-caller');
  });

  it('generates one when the caller supplies none', async () => {
    const server = await start();
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('error handling', () => {
  it('answers an unknown route in Norwegian with a machine-readable code', async () => {
    const server = await start();
    const response = await server.inject({ method: 'GET', url: '/finnes-ikke' });
    expect(response.statusCode).toBe(404);
    expect(response.json()).toEqual({
      error: { code: 'not_found', message: 'Ressursen finnes ikke.' },
    });
  });

  it('does not leak an internal error message to the caller', async () => {
    const server = await start();
    server.get('/boom', async () => {
      throw new Error('relation "users" does not exist');
    });
    const response = await server.inject({ method: 'GET', url: '/boom' });

    expect(response.statusCode).toBe(500);
    expect(response.body).not.toContain('relation');
    expect(response.json().error.code).toBe('internal_error');
  });
});

describe('security headers', () => {
  it('sets HSTS and nosniff', async () => {
    const server = await start();
    const response = await server.inject({ method: 'GET', url: '/health' });
    expect(response.headers['strict-transport-security']).toContain('max-age=31536000');
    expect(response.headers['x-content-type-options']).toBe('nosniff');
  });
});
