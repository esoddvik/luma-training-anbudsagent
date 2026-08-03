import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AuthenticationError, AuthorizationError } from '@luma/auth';
import { ApiError, normalizeError, parseOrThrow, validationError } from './errors.js';
import {
  decodeCursor,
  encodeCursor,
  paginationQuerySchema,
  toPage,
  MAX_PAGE_SIZE,
} from '../services/pagination.js';

/**
 * The parts of the API contract that need no database: what a caller is told
 * when something goes wrong, and how a page is cut.
 */

describe('normalizeError', () => {
  it('passes an ApiError through with its code and Norwegian message', () => {
    const result = normalizeError(
      new ApiError('order_not_found', 404, 'Bestillingen finnes ikke.'),
    );
    expect(result.status).toBe(404);
    expect(result.payload).toEqual({
      error: { code: 'order_not_found', message: 'Bestillingen finnes ikke.' },
    });
    expect(result.internal).toBe(false);
  });

  it('maps the auth package errors onto 401 and 403', () => {
    expect(normalizeError(new AuthenticationError()).status).toBe(401);
    expect(normalizeError(new AuthenticationError()).payload.error.code).toBe('unauthenticated');
    expect(normalizeError(new AuthorizationError()).status).toBe(403);
    expect(normalizeError(new AuthorizationError()).payload.error.code).toBe('forbidden');
  });

  it('never lets a database error reach the caller', () => {
    // The shape a Drizzle failure actually has: the SQL is in the message.
    const dbError = new Error(
      'Failed query: select "users"."email" from "users" where "users"."id" = $1',
    );
    const result = normalizeError(dbError);

    expect(result.status).toBe(500);
    expect(result.internal).toBe(true);
    expect(JSON.stringify(result.payload)).not.toContain('select');
    expect(JSON.stringify(result.payload)).not.toContain('users');
    expect(result.payload.error.code).toBe('internal_error');
  });

  it('translates a Fastify body-size rejection instead of echoing its English', () => {
    const fastifyError = Object.assign(new Error('Request body is too large'), {
      statusCode: 413,
      code: 'FST_ERR_CTP_BODY_TOO_LARGE',
    });
    const result = normalizeError(fastifyError);
    expect(result.status).toBe(413);
    expect(result.payload.error.message).toBe('Forespørselen er for stor.');
  });

  it('gives an unknown 4xx a Norwegian sentence rather than the framework text', () => {
    const fastifyError = Object.assign(new Error('Something the framework says'), {
      statusCode: 415,
      code: 'FST_ERR_SOMETHING_NEW',
    });
    expect(normalizeError(fastifyError).payload.error.message).toBe(
      'Forespørselen kunne ikke behandles.',
    );
  });
});

describe('validationError', () => {
  it('names the offending fields in Norwegian without quoting Zod', () => {
    const schema = z.object({ name: z.string(), digestHourLocal: z.number() });
    const parsed = schema.safeParse({ digestHourLocal: 'sju' });
    expect(parsed.success).toBe(false);
    if (parsed.success) return;

    const error = validationError(parsed.error);
    expect(error.statusCode).toBe(400);
    expect(error.code).toBe('validation_error');
    expect(error.message).toContain('name');
    expect(error.message).toContain('digestHourLocal');
    // Zod's own wording is English and describes its internals.
    expect(error.message).not.toMatch(/expected|received|invalid_type/i);
  });

  it('parseOrThrow returns the parsed value on success', () => {
    expect(parseOrThrow(z.object({ a: z.coerce.number() }), { a: '4' })).toEqual({ a: 4 });
  });
});

describe('cursor pagination', () => {
  it('round-trips a cursor', () => {
    const cursor = { key: '2026-08-10T09:00:00.000Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
  });

  it('rejects a malformed cursor rather than passing it to the query builder', () => {
    expect(() => decodeCursor('not-base64-json')).toThrow(/Sidemarkøren/);
    expect(() => decodeCursor(Buffer.from('{"a":1}').toString('base64url'))).toThrow(
      /Sidemarkøren/,
    );
    expect(() => decodeCursor(Buffer.from('[1,2]').toString('base64url'))).toThrow(/Sidemarkøren/);
  });

  it('caps the page size', () => {
    expect(paginationQuerySchema.safeParse({ limit: MAX_PAGE_SIZE + 1 }).success).toBe(false);
    expect(paginationQuerySchema.parse({}).limit).toBe(25);
  });

  it('emits a next cursor only when a further page exists', () => {
    const rows = [
      { id: 'a', at: '1' },
      { id: 'b', at: '2' },
      { id: 'c', at: '3' },
    ];
    const cursorOf = (row: { id: string; at: string }) => ({ key: row.at, id: row.id });

    const full = toPage(rows, 2, cursorOf);
    expect(full.items).toHaveLength(2);
    expect(decodeCursor(full.nextCursor)).toEqual({ key: '2', id: 'b' });

    const last = toPage(rows.slice(0, 2), 2, cursorOf);
    expect(last.nextCursor).toBeUndefined();
  });
});
