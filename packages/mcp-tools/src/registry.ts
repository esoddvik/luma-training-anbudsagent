import type { z } from 'zod';
import { requireScope, ScopeError, type AuthenticatedCaller, type McpScope } from './auth.js';
import { formatZodErrorNb, INTERNAL_ERROR_NB, ToolError, type ToolErrorCode } from './errors.js';
import {
  readOnlyPorts,
  writeToolPorts,
  type ReadToolPorts,
  type ToolAuditEvent,
  type ToolOutcome,
  type ToolPorts,
  type WriteToolPorts,
} from './ports.js';

/**
 * Tool definition, registration and invocation.
 *
 * `apps/mcp` registers the whole surface by iterating `LUMA_TOOLS`; it never
 * names an individual tool. Adding a phase 7 tool (spec section 32.2) is
 * therefore a change in this package only.
 *
 * Every call goes through `invokeTool`, and that is where the three
 * non-negotiables live, in this order:
 *
 * 1. **Scope before data.** `requireScope` runs before the input is even
 *    parsed, so a token without the scope cannot reach a port at all.
 * 2. **Read tools get read-only ports.** A read tool is handed an object that
 *    has no write method on it (`readOnlyPorts`), so "read tools cannot write"
 *    (spec section 40) is a property of the object graph rather than of the
 *    handler's good behaviour.
 * 3. **Audit always.** Success, refusal, bad input and crash all produce
 *    exactly one audit row, and the row cannot carry free text (spec section
 *    9.5, ADR-0003).
 */

export interface ReadToolContext {
  readonly caller: AuthenticatedCaller;
  readonly ports: ReadToolPorts;
  /** Passed in rather than read from the clock, so a tool stays reproducible. */
  readonly now: Date;
}

export interface WriteToolContext {
  readonly caller: AuthenticatedCaller;
  readonly ports: WriteToolPorts;
  readonly now: Date;
}

/**
 * The ids and counts a tool contributes to its audit row.
 *
 * The type is the guard: there is no field free text could be assigned to.
 * `invokeTool` re-checks the ids against an id shape before recording them.
 */
export interface ToolAuditFacts {
  readonly targetTenderId?: string | null;
  readonly targetProfileId?: string | null;
  readonly resultCount?: number | null;
}

interface ToolMeta {
  readonly name: string;
  /** Norwegian, shown in client tool pickers. */
  readonly title: string;
  /** Norwegian. Read by the calling model to decide when to use the tool. */
  readonly description: string;
  readonly requiredScopes: readonly McpScope[];
  /**
   * True only for `get_luma_learning_resource`.
   *
   * Spec section 32.1 makes it the one explicit Luma tool and forbids a search
   * tool from calling it automatically. The flag lets a test assert that
   * exactly one tool carries Luma content, and lets the server surface the
   * distinction to the client.
   */
  readonly lumaContent: boolean;
}

export interface ReadTool extends ToolMeta {
  readonly kind: 'read';
  readonly inputSchema: z.ZodType;
  run(input: unknown, context: ReadToolContext): Promise<unknown>;
  auditFacts(input: unknown, result: unknown): ToolAuditFacts;
}

export interface WriteTool extends ToolMeta {
  readonly kind: 'write';
  readonly inputSchema: z.ZodType;
  run(input: unknown, context: WriteToolContext): Promise<unknown>;
  auditFacts(input: unknown, result: unknown): ToolAuditFacts;
}

export type LumaTool = ReadTool | WriteTool;

interface ToolSpec<S extends z.ZodType, TResult> extends ToolMeta {
  readonly inputSchema: S;
  readonly auditFacts?: (input: z.output<S>, result: TResult | undefined) => ToolAuditFacts;
}

/**
 * The one place input is cast.
 *
 * `invokeTool` parses with the tool's own schema immediately before calling
 * `run`, so the value is `z.output<S>` by construction. Keeping the cast here,
 * once, is what lets every handler be written against a precise input type.
 */
function eraseHandler<S extends z.ZodType, TResult, TContext>(
  handler: (input: z.output<S>, context: TContext) => Promise<TResult>,
): (input: unknown, context: TContext) => Promise<unknown> {
  return (input, context) => handler(input as z.output<S>, context);
}

function eraseAuditFacts<S extends z.ZodType, TResult>(
  facts: ((input: z.output<S>, result: TResult | undefined) => ToolAuditFacts) | undefined,
): (input: unknown, result: unknown) => ToolAuditFacts {
  if (facts === undefined) return () => ({});
  return (input, result) => facts(input as z.output<S>, result as TResult | undefined);
}

export function defineReadTool<S extends z.ZodType, TResult>(
  spec: ToolSpec<S, TResult> & {
    handler: (input: z.output<S>, context: ReadToolContext) => Promise<TResult>;
  },
): ReadTool {
  return {
    kind: 'read',
    name: spec.name,
    title: spec.title,
    description: spec.description,
    requiredScopes: spec.requiredScopes,
    lumaContent: spec.lumaContent,
    inputSchema: spec.inputSchema,
    run: eraseHandler<S, TResult, ReadToolContext>(spec.handler),
    auditFacts: eraseAuditFacts<S, TResult>(spec.auditFacts),
  };
}

export function defineWriteTool<S extends z.ZodType, TResult>(
  spec: ToolSpec<S, TResult> & {
    handler: (input: z.output<S>, context: WriteToolContext) => Promise<TResult>;
  },
): WriteTool {
  return {
    kind: 'write',
    name: spec.name,
    title: spec.title,
    description: spec.description,
    requiredScopes: spec.requiredScopes,
    lumaContent: spec.lumaContent,
    inputSchema: spec.inputSchema,
    run: eraseHandler<S, TResult, WriteToolContext>(spec.handler),
    auditFacts: eraseAuditFacts<S, TResult>(spec.auditFacts),
  };
}

/* -------------------------------------------------------------------------- */
/* Invocation                                                                 */
/* -------------------------------------------------------------------------- */

export type ToolInvocation =
  | { readonly ok: true; readonly result: unknown }
  | { readonly ok: false; readonly code: ToolErrorCode; readonly message: string };

export interface InvocationContext {
  readonly caller: AuthenticatedCaller;
  readonly ports: ToolPorts;
  readonly now: Date;
  /** Overridable so a test can assert a duration without touching the clock. */
  readonly elapsedMs?: () => number;
}

const UNKNOWN_TOOL_NB = (name: string) => `Verktøyet «${name}» finnes ikke på denne serveren.`;

const OUTCOME_FOR_CODE: Readonly<Record<ToolErrorCode, ToolOutcome>> = {
  invalid_input: 'invalid_input',
  forbidden: 'forbidden',
  not_found: 'not_found',
  conflict: 'conflict',
  internal_error: 'internal_error',
};

/** Ids are UUIDs everywhere in this system; anything else is not an id. */
const ID_SHAPE = /^[0-9a-fA-F-]{36}$/;

function safeId(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null;
  return ID_SHAPE.test(value) ? value : null;
}

export async function invokeToolFrom(
  tools: readonly LumaTool[],
  toolName: string,
  rawInput: unknown,
  context: InvocationContext,
): Promise<ToolInvocation> {
  const startedAt = Date.now();
  const elapsed = context.elapsedMs ?? (() => Date.now() - startedAt);

  const tool = tools.find((candidate) => candidate.name === toolName);

  const audit = async (
    outcome: ToolOutcome,
    facts: ToolAuditFacts,
    missingScope: McpScope | null,
  ): Promise<void> => {
    const event: ToolAuditEvent = {
      toolName,
      userId: context.caller.userId,
      tokenId: context.caller.tokenId,
      outcome,
      requiredScopes: tool?.requiredScopes ?? [],
      missingScope,
      targetTenderId: safeId(facts.targetTenderId),
      targetProfileId: safeId(facts.targetProfileId),
      resultCount: typeof facts.resultCount === 'number' ? facts.resultCount : null,
      durationMs: elapsed(),
      occurredAt: context.now,
    };
    await context.ports.audit.record(event);
  };

  if (tool === undefined) {
    await audit('not_found', {}, null);
    return { ok: false, code: 'not_found', message: UNKNOWN_TOOL_NB(toolName) };
  }

  // 1. Scope, before anything reads or parses. Spec section 40.
  try {
    for (const scope of tool.requiredScopes) requireScope(context.caller, scope);
  } catch (error) {
    if (error instanceof ScopeError) {
      await audit('forbidden', {}, error.required);
      return { ok: false, code: 'forbidden', message: scopeMessageNb(tool, error.required) };
    }
    throw error;
  }

  // 2. Input.
  const parsed = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    await audit('invalid_input', {}, null);
    return { ok: false, code: 'invalid_input', message: formatZodErrorNb(parsed.error) };
  }

  // 3. Run, with the port bundle the tool's kind allows.
  try {
    const result =
      tool.kind === 'read'
        ? await tool.run(parsed.data, {
            caller: context.caller,
            ports: readOnlyPorts(context.ports),
            now: context.now,
          })
        : await tool.run(parsed.data, {
            caller: context.caller,
            ports: writeToolPorts(context.ports),
            now: context.now,
          });

    await audit('ok', tool.auditFacts(parsed.data, result), null);
    return { ok: true, result };
  } catch (error) {
    if (error instanceof ToolError) {
      await audit(OUTCOME_FOR_CODE[error.code], tool.auditFacts(parsed.data, undefined), null);
      return { ok: false, code: error.code, message: error.message };
    }
    if (error instanceof ScopeError) {
      await audit('forbidden', {}, error.required);
      return { ok: false, code: 'forbidden', message: scopeMessageNb(tool, error.required) };
    }
    await audit('internal_error', {}, null);
    return { ok: false, code: 'internal_error', message: INTERNAL_ERROR_NB };
  }
}

function scopeMessageNb(tool: LumaTool, missing: McpScope): string {
  return (
    `Tokenet ditt mangler tilgangen «${missing}», som «${tool.name}» krever. ` +
    'Lag et nytt MCP-token med riktige tilganger i Luma Anbudsvarsling, eller be brukeren om å gjøre det.'
  );
}

/**
 * The registry itself is `LUMA_TOOLS` in `./tools/index.js`, and `invokeTool`
 * there is this function bound to it. Keeping the list out of this module
 * avoids a mutable module-level registry, and with it the import-order bug
 * where a tool file has not run yet when the first request arrives.
 */
