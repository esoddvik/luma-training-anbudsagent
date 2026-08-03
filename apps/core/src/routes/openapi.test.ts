import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_SHARE_FIELDS } from '@luma/domain';
import { createLogger } from '@luma/observability';
import { buildServer } from '../server.js';
import { registerApiRoutes } from './index.js';
import {
  buildOpenApiDocument,
  operationKey,
  OPENAPI_VERSION,
  OPERATIONS,
  type RouteRef,
} from './openapi.js';
import type { ApiContext } from '../services/context.js';

/**
 * The drift guard for the OpenAPI document (spec §39).
 *
 * A hand-maintained API document is worse than none: it looks authoritative
 * and stops being true the first time somebody adds a route. So the document
 * is generated from the real route table, and the test below fails in **both**
 * directions — an undocumented route, and a documented path that no longer
 * exists.
 *
 * These tests need no database. `ApiContext` is a stub because registration
 * never touches it; only handlers do, and none run here.
 */

const logger = createLogger({ service: 'core', silent: true });

/**
 * Enough of an `ApiContext` to register routes and serve the document.
 *
 * Not a throwing proxy, which was the first attempt and failed for an
 * instructive reason: the session `preHandler` runs for *every* route in the
 * plugin, including the public ones, so even fetching `/openapi.json`
 * resolves an actor. It short-circuits without a cookie — `validateSession`
 * returns before it touches the store — so an anonymous document fetch costs
 * no database round trip. But it does read `config.authSecret` and call
 * `now()`, so those have to be real.
 */
function stubContext(): ApiContext {
  return {
    db: {},
    email: {},
    logger,
    now: () => new Date('2026-08-10T09:00:00Z'),
    config: { authSecret: 'a'.repeat(40), isProduction: false, adminEmails: [] },
    billing: {},
    jobs: {},
    deferred: { enqueue: async () => undefined },
  } as unknown as ApiContext;
}

/**
 * The routes Fastify actually registered, from an `onRoute` hook.
 *
 * Deliberately not from `printRoutes`: that renders a *tree*, in which a child
 * line carries only its path suffix (`└── /:id`), so reconstructing full paths
 * from it under-counts — and under-counts silently, which is the failure this
 * whole test exists to prevent. `onRoute` reports the resolved url for every
 * registration, and a hook on the root instance also fires for routes
 * registered inside encapsulated child plugins.
 */
async function registeredRoutes(): Promise<RouteRef[]> {
  const routes: RouteRef[] = [];
  const app = Fastify();
  app.addHook('onRoute', (route) => {
    const methods = Array.isArray(route.method) ? route.method : [route.method];
    for (const method of methods) {
      if (method === 'HEAD') continue;
      routes.push({ method, url: route.url });
    }
  });
  await registerApiRoutes(app as unknown as Parameters<typeof registerApiRoutes>[0], {
    ctx: stubContext(),
    allowedOrigins: [],
  });
  await app.close();
  return routes;
}

describe('OpenAPI document', () => {
  it('describes exactly the routes that exist, in both directions', async () => {
    const actual = new Set((await registeredRoutes()).map(operationKey));
    const documented = new Set(Object.keys(OPERATIONS));

    // Listed separately so a failure names the offender rather than dumping
    // two forty-item sets and leaving the reader to diff them.
    const undocumented = [...actual].filter((key) => !documented.has(key)).sort();
    const phantom = [...documented].filter((key) => !actual.has(key)).sort();

    expect({ undocumented, phantom }).toEqual({ undocumented: [], phantom: [] });
  });

  it('is a valid-looking OpenAPI 3.1 document with a path per route', async () => {
    const routes = await registeredRoutes();
    const doc = buildOpenApiDocument(routes);

    expect(doc.openapi).toBe(OPENAPI_VERSION);
    expect(Object.keys(doc.paths).length).toBeGreaterThan(30);
    // Every route resolved to a documented operation.
    expect(JSON.stringify(doc)).not.toContain('UNDOCUMENTED');
  });

  it('derives request schemas from the validators the handlers use', async () => {
    const doc = buildOpenApiDocument(await registeredRoutes());
    const create = doc.paths['/api/v1/alert-profiles']?.post as {
      requestBody: { content: { 'application/json': { schema: { properties: object } } } };
    };
    const properties = create.requestBody.content['application/json'].schema.properties;

    // These names exist because `alertProfileInputSchema` has them, not
    // because someone typed them into a document.
    expect(Object.keys(properties)).toEqual(
      expect.arrayContaining(['name', 'cpvInclude', 'keywordsInclude', 'frequency']),
    );
  });

  it('documents the shared view without naming a field it withholds', async () => {
    const doc = buildOpenApiDocument(await registeredRoutes());
    const operation = doc.paths['/api/v1/shared/{token}']?.get as {
      responses: Record<string, { content?: Record<string, { schema: unknown }> }>;
    };
    const body = JSON.stringify(operation.responses['200']?.content?.['application/json']?.schema);

    // Scoped to the response *schema*. The operation as a whole legitimately
    // names a `token` path parameter, which is the URL segment, not a field
    // the shared view returns — checking the whole operation would flag that
    // and teach the next person to weaken the assertion.
    for (const field of FORBIDDEN_SHARE_FIELDS) {
      expect(body).not.toContain(field);
    }
    expect(body).toContain('matchReasonTypes');
    // 410 for revoked, expired and unknown alike — documented, not invented.
    expect(Object.keys(operation.responses)).toContain('410');
  });

  it('does not invent status codes', async () => {
    const doc = buildOpenApiDocument(await registeredRoutes());

    const del = doc.paths['/api/v1/alert-profiles/{id}']?.delete as {
      responses: Record<string, unknown>;
    };
    expect(Object.keys(del.responses)).toContain('204');
    expect(Object.keys(del.responses)).not.toContain('200');

    const requestLink = doc.paths['/api/v1/auth/request-link']?.post as {
      responses: Record<string, unknown>;
      security?: unknown[];
    };
    expect(Object.keys(requestLink.responses)).toContain('202');
    // Public: no session required, so no 401/403 from the shared set.
    expect(requestLink.security).toEqual([]);
    expect(Object.keys(requestLink.responses)).not.toContain('403');
  });

  it('is served publicly and needs no CSRF header', async () => {
    const app = await buildServer({
      logger,
      allowedOrigins: ['https://example.test'],
      api: stubContext(),
    });
    const response = await app.inject({ method: 'GET', url: '/api/v1/openapi.json' });

    expect(response.statusCode).toBe(200);
    expect(response.json().openapi).toBe(OPENAPI_VERSION);
    expect(response.json().paths['/api/v1/shared/{token}']).toBeDefined();
    await app.close();
  });
});
