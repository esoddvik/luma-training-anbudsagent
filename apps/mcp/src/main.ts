// Environment first: ES module imports are hoisted, so this side-effecting
// import must precede any module that reads configuration.
import { loadDotEnv } from '@luma/config';
loadDotEnv();

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { getMcpEnv } from '@luma/config';
import {
  buildHealthReport,
  createLogger,
  newCorrelationId,
  readinessHttpStatus,
  runReadinessChecks,
  withCorrelationId,
} from '@luma/observability';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createDatabase, databaseDependencyCheck } from '@luma/db';
import { authenticate } from '@luma/mcp-tools';
import { createToolPorts, createTokenLookup } from './adapters/db-ports.js';
import { SERVER_INFO, SERVER_INSTRUCTIONS_NB } from './instructions.js';
import { allowedHostsFrom, isHostAllowed } from './host-allowlist.js';
import { registerLumaSurface } from './register-tools.js';

const DEFAULT_PORT = 8081;
const MCP_PATH = '/mcp';

/**
 * The MCP server runs as its own Railway service (ADR-1).
 *
 * The reason is operational rather than architectural: this is Luma's live
 * demo surface on stage and in webinars, and it must stay responsive while the
 * core service is running a Doffin ingest or a digest burst.
 *
 * Transport is stateless Streamable HTTP: no session id generator, JSON
 * responses rather than SSE. Every request carries its own bearer token and
 * resolves its own user, so there is no server-side session to keep, and any
 * instance can serve any request.
 */
function buildMcpServer(): McpServer {
  return new McpServer(SERVER_INFO, { instructions: SERVER_INSTRUCTIONS_NB });
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
  });
  response.end(payload);
}

async function main(): Promise<void> {
  const env = getMcpEnv();
  const logger = createLogger({
    service: 'mcp',
    level: env.LOG_LEVEL,
    pretty: env.NODE_ENV === 'development',
  });

  const allowedHosts = allowedHostsFrom(env.MCP_URL, env.MCP_ALLOWED_HOSTS);

  const startedAt = Date.now();

  const { db, close: closeDb } = createDatabase();
  const ports = createToolPorts(db);
  const lookupToken = createTokenLookup(db);

  const http = createServer((request: IncomingMessage, response: ServerResponse) => {
    const correlationId = newCorrelationId();
    response.setHeader('x-correlation-id', correlationId);

    void withCorrelationId(correlationId, async () => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);

      if (url.pathname === '/health') {
        sendJson(response, 200, buildHealthReport('mcp', (Date.now() - startedAt) / 1000));
        return;
      }

      if (url.pathname === '/ready') {
        const report = await runReadinessChecks('mcp', [databaseDependencyCheck(db)]);
        sendJson(response, readinessHttpStatus(report), report);
        return;
      }

      if (url.pathname !== MCP_PATH) {
        sendJson(response, 404, {
          error: { code: 'not_found', message: 'Ressursen finnes ikke.' },
        });
        return;
      }

      // Host allowlist (spec §40). Deliberately before authentication: it is
      // the cheaper check, it touches no database, and a rebound request
      // should never reach the token lookup at all. The offending host is
      // logged but not echoed back — a reflected value is a small gift to
      // whoever is probing, and the operator needs it more than the caller.
      if (!isHostAllowed(request.headers.host, allowedHosts)) {
        logger.warn(
          { host: request.headers.host, path: url.pathname },
          'rejected MCP request with a host outside the allowlist',
        );
        sendJson(response, 403, {
          error: { code: 'forbidden', message: 'Ugyldig vert for denne tjenesten.' },
        });
        return;
      }

      // Authenticate before doing any work. The reason is not returned to the
      // caller: a client that can tell "revoked" from "never existed" can probe
      // for valid tokens, and there is nothing useful it would do with the
      // distinction anyway.
      const auth = await authenticate({
        authorizationHeader: request.headers.authorization,
        pepper: env.MCP_TOKEN_PEPPER,
        lookup: lookupToken,
        now: new Date(),
      });

      if (!auth.ok) {
        logger.info({ reason: auth.reason }, 'mcp request rejected');
        response.setHeader('www-authenticate', 'Bearer realm="luma-anbudsvarsling"');
        sendJson(response, 401, {
          error: {
            code: 'unauthorized',
            message:
              'Ugyldig eller manglende MCP-token. Opprett et nytt token under Integrasjoner i Luma Anbudsvarsling.',
          },
        });
        return;
      }

      // A fresh server and transport per request keeps the service stateless
      // and prevents one client's stream from affecting another's.
      const server = buildMcpServer();
      registerLumaSurface({ server, caller: auth.caller, ports, logger });
      const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true });

      response.on('close', () => {
        void transport.close();
        void server.close();
      });

      try {
        await server.connect(transport);
        await transport.handleRequest(request, response);
      } catch (error) {
        logger.error({ err: error }, 'mcp request failed');
        if (!response.headersSent) {
          sendJson(response, 500, {
            error: { code: 'internal_error', message: 'Det oppsto en uventet feil.' },
          });
        }
      }
    });
  });

  const port = Number(process.env.PORT ?? DEFAULT_PORT);
  http.listen(port, '0.0.0.0', () => {
    logger.info({ port, path: MCP_PATH }, 'mcp service listening');
  });

  const close = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'shutting down');
    // HTTP first, then the pool: closing the database while a request is still
    // running would fail it for no reason.
    http.close(() => {
      void closeDb().then(
        () => process.exit(0),
        () => process.exit(1),
      );
    });
    setTimeout(() => process.exit(1), 15_000).unref();
  };
  process.on('SIGTERM', () => close('SIGTERM'));
  process.on('SIGINT', () => close('SIGINT'));
}

main().catch((error: unknown) => {
  // Startup failures must reach the platform log even before a logger exists.
  console.error('mcp service failed to start', error);
  process.exitCode = 1;
});
