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
import { SERVER_INFO, SERVER_INSTRUCTIONS_NB } from './instructions.js';

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

  const startedAt = Date.now();

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
        // No dependency probes registered until the database layer is wired in.
        const report = await runReadinessChecks('mcp', []);
        sendJson(response, readinessHttpStatus(report), report);
        return;
      }

      if (url.pathname !== MCP_PATH) {
        sendJson(response, 404, {
          error: { code: 'not_found', message: 'Ressursen finnes ikke.' },
        });
        return;
      }

      // A fresh server and transport per request keeps the service stateless
      // and prevents one client's stream from affecting another's.
      const server = buildMcpServer();
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
    http.close(() => process.exit(0));
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
