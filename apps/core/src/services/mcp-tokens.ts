import { and, desc, eq, lt, or } from 'drizzle-orm';
import { generateToken, tokenDisplayPrefix } from '@luma/auth';
import { mcpTokens } from '@luma/db';
import { z } from 'zod';
import { badRequest, notFound, parseOrThrow } from '../routes/errors.js';
import { requireOwnershipAudited } from './audit.js';
import { decodeCursor, toPage, type Page, type PaginationQuery } from './pagination.js';
import type { Actor, ApiContext } from './context.js';

/**
 * Personal access tokens for the MCP server (spec §30, ADR-0003).
 *
 * Only the hash is stored, and the full token is returned exactly once. That
 * is not a nicety: an MCP token grants read access to a supplier's entire
 * tender pipeline, and a recoverable token would make a database dump
 * equivalent to a session for every account that ever created one.
 */

const MCP_SCOPES = [
  'tenders:read',
  'profiles:read',
  'profiles:write',
  'saved:read',
  'saved:write',
  'feedback:write',
] as const;

/**
 * The MVP grants read scopes and the limited saved actions (spec §30). Write
 * scopes exist in the schema so phase 7 does not need a migration, but the API
 * will not hand them out yet.
 */
const MVP_GRANTABLE_SCOPES: readonly string[] = [
  'tenders:read',
  'profiles:read',
  'saved:read',
  'saved:write',
  'feedback:write',
];

export const createMcpTokenInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  scopes: z.array(z.enum(MCP_SCOPES)).min(1).max(MCP_SCOPES.length),
  /** Optional expiry. Omitted means the token lives until revoked. */
  expiresInDays: z.number().int().positive().max(730).optional(),
});

export interface McpTokenView {
  readonly id: string;
  readonly name: string;
  readonly prefix: string;
  readonly scopes: readonly string[];
  readonly createdAt: Date;
  readonly expiresAt: Date | null;
  readonly lastUsedAt: Date | null;
  readonly revokedAt: Date | null;
}

export interface CreatedMcpToken extends McpTokenView {
  /** Shown once. Absent from every subsequent read. */
  readonly token: string;
}

export async function createMcpToken(
  ctx: ApiContext,
  actor: Actor,
  body: unknown,
): Promise<CreatedMcpToken> {
  const input = parseOrThrow(createMcpTokenInputSchema, body);

  const forbidden = input.scopes.filter((scope) => !MVP_GRANTABLE_SCOPES.includes(scope));
  if (forbidden.length > 0) {
    throw badRequest(
      'scope_not_available',
      `Følgende tilgangsområder kan ikke tildeles ennå: ${forbidden.join(', ')}.`,
    );
  }

  const now = ctx.now();
  const { token, tokenHash } = generateToken(ctx.config.mcpTokenPepper, 'luma_mcp_');
  const expiresAt = input.expiresInDays
    ? new Date(now.getTime() + input.expiresInDays * 86_400_000)
    : null;

  const inserted = await ctx.db
    .insert(mcpTokens)
    .values({
      userId: actor.userId,
      name: input.name,
      prefix: tokenDisplayPrefix(token, 16),
      tokenHash,
      scopes: input.scopes,
      expiresAt,
      createdAt: now,
    })
    .returning({ id: mcpTokens.id, prefix: mcpTokens.prefix });

  const row = inserted[0];
  if (!row) throw new Error('insert returned no mcp token id');

  // The token itself is never logged (§40). The id and prefix are enough to
  // tie a later audit event back to this creation.
  ctx.logger.info({ mcpTokenId: row.id, scopes: input.scopes }, 'MCP-token opprettet');

  return {
    id: row.id,
    name: input.name,
    prefix: row.prefix,
    scopes: input.scopes,
    createdAt: now,
    expiresAt,
    lastUsedAt: null,
    revokedAt: null,
    token,
  };
}

export async function listMcpTokens(
  ctx: ApiContext,
  actor: Actor,
  query: PaginationQuery,
): Promise<Page<McpTokenView>> {
  const cursor = decodeCursor(query.cursor);
  const rows = await ctx.db
    .select({
      id: mcpTokens.id,
      name: mcpTokens.name,
      prefix: mcpTokens.prefix,
      scopes: mcpTokens.scopes,
      createdAt: mcpTokens.createdAt,
      expiresAt: mcpTokens.expiresAt,
      lastUsedAt: mcpTokens.lastUsedAt,
      revokedAt: mcpTokens.revokedAt,
    })
    .from(mcpTokens)
    .where(
      and(
        eq(mcpTokens.userId, actor.userId),
        cursor
          ? or(
              lt(mcpTokens.createdAt, new Date(cursor.key)),
              and(eq(mcpTokens.createdAt, new Date(cursor.key)), lt(mcpTokens.id, cursor.id)),
            )
          : undefined,
      ),
    )
    .orderBy(desc(mcpTokens.createdAt), desc(mcpTokens.id))
    .limit(query.limit + 1);

  return toPage(rows, query.limit, (row) => ({
    key: row.createdAt.toISOString(),
    id: row.id,
  }));
}

export async function revokeMcpToken(
  ctx: ApiContext,
  actor: Actor,
  tokenId: string,
): Promise<{ id: string; revokedAt: Date }> {
  const rows = await ctx.db.select().from(mcpTokens).where(eq(mcpTokens.id, tokenId)).limit(1);
  const row = rows[0];
  if (!row) throw notFound('Tokenet finnes ikke.');

  await requireOwnershipAudited(ctx, {
    actor,
    resourceOwnerId: row.userId,
    action: 'mcp_token.revoked_as_admin',
    entityType: 'mcp_token',
    entityId: tokenId,
  });

  const revokedAt = row.revokedAt ?? ctx.now();
  if (!row.revokedAt) {
    await ctx.db.update(mcpTokens).set({ revokedAt }).where(eq(mcpTokens.id, tokenId));
  }
  return { id: tokenId, revokedAt };
}
