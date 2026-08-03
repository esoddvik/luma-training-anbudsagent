import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  invokeTool,
  LUMA_RESOURCES,
  LUMA_TOOLS,
  type AuthenticatedCaller,
  type ToolPorts,
} from '@luma/mcp-tools';
import type { Logger } from '@luma/observability';
import { LUMA_PROMPTS } from './prompts.js';

/**
 * Registering the tool, resource and prompt surface on an MCP server instance.
 *
 * The server is constructed per request (see `main.ts`), so this runs on every
 * call. It is deliberately cheap: the tool definitions are a frozen module-level
 * array, and all this does is bind them to one authenticated caller.
 *
 * Authorisation is not done here. `invokeTool` checks scope before touching a
 * port and writes the audit row either way, so there is exactly one place where
 * that can be got wrong.
 */

export interface RegisterToolsOptions {
  server: McpServer;
  caller: AuthenticatedCaller;
  ports: ToolPorts;
  logger: Logger;
  now?: () => Date;
}

/** The Norwegian text a client sees when a tool fails. */
function errorContent(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

function successContent(result: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
  };
}

export function registerLumaSurface(options: RegisterToolsOptions): void {
  const { server, caller, ports, logger } = options;
  const now = options.now ?? (() => new Date());

  for (const tool of LUMA_TOOLS) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
      },
      async (rawInput: unknown) => {
        const invocation = await invokeTool(tool.name, rawInput, {
          caller,
          ports,
          now: now(),
        });

        if (!invocation.ok) {
          // Logged without the input: spec §9.5 keeps conversation content out
          // of our storage, and a log is storage.
          logger.info(
            { tool: tool.name, code: invocation.code, userId: caller.userId },
            'mcp tool call refused',
          );
          return errorContent(invocation.message);
        }

        return successContent(invocation.result);
      },
    );
  }

  for (const resource of LUMA_RESOURCES) {
    server.registerResource(
      resource.name,
      resource.uri,
      {
        title: resource.title,
        description: resource.description,
        mimeType: resource.mimeType,
      },
      async (uri) => ({
        contents: [{ uri: uri.href, mimeType: resource.mimeType, text: resource.text }],
      }),
    );
  }

  for (const prompt of LUMA_PROMPTS) {
    // Built from the prompt's declared argument names so the two cannot drift:
    // a prompt that renders `tenderId` must also advertise it, or a client has
    // no way to supply it.
    const argsSchema = Object.fromEntries(
      prompt.argumentNames.map((name) => [name, z.string().optional()]),
    );

    server.registerPrompt(
      prompt.name,
      { title: prompt.title, description: prompt.description, argsSchema },
      (args: Record<string, string | undefined>) => ({
        messages: [
          {
            role: 'user' as const,
            content: {
              type: 'text' as const,
              text: prompt.render(
                Object.fromEntries(
                  Object.entries(args).filter(
                    (entry): entry is [string, string] => typeof entry[1] === 'string',
                  ),
                ),
              ),
            },
          },
        ],
      }),
    );
  }
}
