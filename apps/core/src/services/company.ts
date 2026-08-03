import { and, eq, isNull } from 'drizzle-orm';
import { AuthorizationError } from '@luma/auth';
import { companies, companyMemberships } from '@luma/db';
import { z } from 'zod';
import { badRequest, conflict, parseOrThrow } from '../routes/errors.js';
import { requireOwnershipAudited } from './audit.js';
import type { Actor, ApiContext } from './context.js';

/**
 * The company profile — «virksomhetsprofil» in spec §7.1 (spec §9.1, §39).
 *
 * ## Scope
 *
 * There is exactly one company per caller, reached through their own
 * `company_memberships` row. The service never takes a company id from the
 * request: an endpoint that did would need an authorisation check to stop a
 * caller naming somebody else's company, and the safest version of that check
 * is not having the parameter. `requireOwnershipAudited` still runs on the
 * membership, so the administrator support path (`requireOwnership` lets an
 * admin through, `packages/auth` requires the access to be audited) stays
 * covered if a company id is ever added here.
 *
 * ## Why the organisation number is validated but never required
 *
 * Spec §9.1 step 6 marks it «valgfritt i første steg», and the acceptance
 * criterion for that journey is that it completes in under five minutes.
 * Making a nine-digit number mandatory at the point where somebody is deciding
 * whether to bother is a good way to fail that criterion. So: absent is fine,
 * wrong is not.
 */

/**
 * The MOD-11 control digit Brønnøysund uses, checked rather than assumed.
 *
 * Length and digit-ness alone would accept a transposed number, which is the
 * most common way to get one wrong by hand — and a wrong organisation number
 * looks exactly like a right one on the screen it was typed into.
 */
const ORGANIZATION_NUMBER_WEIGHTS = [3, 2, 7, 6, 5, 4, 3, 2] as const;

export function isValidOrganizationNumber(value: string): boolean {
  if (!/^\d{9}$/.test(value)) return false;

  let sum = 0;
  for (const [index, weight] of ORGANIZATION_NUMBER_WEIGHTS.entries()) {
    // Safe under noUncheckedIndexedAccess: the regex above fixed the length.
    sum += Number(value[index] ?? '0') * weight;
  }

  const remainder = sum % 11;
  const control = remainder === 0 ? 0 : 11 - remainder;
  // A remainder of 1 leaves a control digit of 10, which cannot be written.
  if (control === 10) return false;
  return control === Number(value[8] ?? '-1');
}

/** Strips the spaces people type between the groups: `912 345 678`. */
function normalizeOrganizationNumber(value: string): string {
  return value.replace(/[\s.]/g, '');
}

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((value) => (value.length === 0 ? null : value))
    .nullable()
    .optional();

export const updateCompanyInputSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    /** Null clears it. Absent leaves it alone. */
    organizationNumber: z
      .string()
      .trim()
      .max(20)
      .transform(normalizeOrganizationNumber)
      .nullable()
      .optional(),
    industryDescription: optionalText(2000),
    servicesOffered: optionalText(2000),
  })
  .refine((value) => Object.keys(value).length > 0, {
    message: 'empty',
    path: ['name'],
  });

export interface CompanyView {
  readonly id: string;
  readonly name: string;
  readonly organizationNumber: string | null;
  readonly industryDescription: string | null;
  readonly servicesOffered: string | null;
  /** The caller's role in the company. Only `owner` and `admin` may write. */
  readonly role: 'owner' | 'admin' | 'member';
  readonly updatedAt: Date;
}

interface MembershipRow {
  readonly membershipUserId: string;
  readonly companyId: string;
  readonly role: 'owner' | 'admin' | 'member';
}

async function membershipOf(ctx: ApiContext, userId: string): Promise<MembershipRow | undefined> {
  const rows = await ctx.db
    .select({
      membershipUserId: companyMemberships.userId,
      companyId: companyMemberships.companyId,
      role: companyMemberships.role,
    })
    .from(companyMemberships)
    .innerJoin(companies, eq(companies.id, companyMemberships.companyId))
    // A soft-deleted company is not a company the user has (schema: companies
    // are soft-deleted so an accidental removal does not take the memberships
    // with it). Without this the profile would keep answering from a row
    // nobody can act on.
    .where(and(eq(companyMemberships.userId, userId), isNull(companies.deletedAt)))
    .limit(1);
  return rows[0];
}

async function companyView(
  ctx: ApiContext,
  companyId: string,
  role: MembershipRow['role'],
): Promise<CompanyView> {
  const rows = await ctx.db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  const row = rows[0];
  if (!row) throw new Error(`company ${companyId} disappeared between reads`);
  return {
    id: row.id,
    name: row.name,
    organizationNumber: row.organizationNumber,
    industryDescription: row.industryDescription,
    servicesOffered: row.servicesOffered,
    role,
    updatedAt: row.updatedAt,
  };
}

/**
 * `GET /api/v1/company`.
 *
 * `null` rather than a 404 when the caller has no company yet: not having one
 * is the ordinary state of a brand-new account (spec §9.1 fills it in during
 * onboarding), and a 404 would make the web app treat an expected condition as
 * an error.
 */
export async function getCompany(ctx: ApiContext, actor: Actor): Promise<CompanyView | null> {
  const membership = await membershipOf(ctx, actor.userId);
  if (!membership) return null;

  await requireOwnershipAudited(ctx, {
    actor,
    resourceOwnerId: membership.membershipUserId,
    action: 'company.accessed_as_admin',
    entityType: 'company',
    entityId: membership.companyId,
  });

  return companyView(ctx, membership.companyId, membership.role);
}

/**
 * `PATCH /api/v1/company`.
 *
 * Creates the company the first time, because there is no separate "create
 * company" step in §9.1 — the user fills in a form and it exists afterwards.
 * The creator becomes `owner`.
 */
export async function updateCompany(
  ctx: ApiContext,
  actor: Actor,
  body: unknown,
): Promise<CompanyView> {
  const input = parseOrThrow(updateCompanyInputSchema, body ?? {});

  if (
    input.organizationNumber !== undefined &&
    input.organizationNumber !== null &&
    !isValidOrganizationNumber(input.organizationNumber)
  ) {
    throw badRequest(
      'organization_number_invalid',
      'Organisasjonsnummeret må være ni siffer med gyldig kontrollsiffer.',
    );
  }

  const now = ctx.now();
  const membership = await membershipOf(ctx, actor.userId);

  if (!membership) {
    if (!input.name) {
      throw badRequest('company_name_required', 'Virksomheten må ha et navn.');
    }
    return createCompany(ctx, actor, { ...input, name: input.name }, now);
  }

  await requireOwnershipAudited(ctx, {
    actor,
    resourceOwnerId: membership.membershipUserId,
    action: 'company.updated_as_admin',
    entityType: 'company',
    entityId: membership.companyId,
  });

  // Authorisation in the service layer (spec §39). A `member` may read the
  // profile their alert profiles hang off, and may not rewrite it for
  // everybody else in the company.
  if (membership.role === 'member') {
    throw new AuthorizationError(
      'Bare eiere og administratorer i virksomheten kan endre virksomhetsprofilen.',
    );
  }

  const patch: Partial<typeof companies.$inferInsert> = { updatedAt: now };
  if (input.name !== undefined) patch.name = input.name;
  if (input.organizationNumber !== undefined) patch.organizationNumber = input.organizationNumber;
  if (input.industryDescription !== undefined) {
    patch.industryDescription = input.industryDescription;
  }
  if (input.servicesOffered !== undefined) patch.servicesOffered = input.servicesOffered;

  await runGuardingOrganizationNumber(() =>
    ctx.db.update(companies).set(patch).where(eq(companies.id, membership.companyId)),
  );

  return companyView(ctx, membership.companyId, membership.role);
}

async function createCompany(
  ctx: ApiContext,
  actor: Actor,
  input: {
    name: string;
    organizationNumber?: string | null;
    industryDescription?: string | null;
    servicesOffered?: string | null;
  },
  now: Date,
): Promise<CompanyView> {
  const inserted = await runGuardingOrganizationNumber(() =>
    ctx.db
      .insert(companies)
      .values({
        name: input.name,
        organizationNumber: input.organizationNumber ?? null,
        industryDescription: input.industryDescription ?? null,
        servicesOffered: input.servicesOffered ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: companies.id }),
  );

  const companyId = inserted[0]?.id;
  if (!companyId) throw new Error('insert returned no company id');

  await ctx.db
    .insert(companyMemberships)
    .values({ companyId, userId: actor.userId, role: 'owner', createdAt: now });

  ctx.logger.info({ companyId }, 'virksomhetsprofil opprettet');
  return companyView(ctx, companyId, 'owner');
}

/**
 * Turns the unique-index violation on `organization_number` into a Norwegian
 * 409.
 *
 * Checked by catching rather than by a `SELECT` first, because the select-then-
 * insert version has a race that produces the leaked constraint name anyway —
 * and spec §39 forbids exposing a database error to a caller.
 */
async function runGuardingOrganizationNumber<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw conflict(
        'organization_number_taken',
        'Organisasjonsnummeret er allerede registrert på en annen virksomhet.',
      );
    }
    throw error;
  }
}

/** PostgreSQL's `unique_violation`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Whether a thrown value is a unique-constraint violation.
 *
 * The `cause` walk is the load-bearing part. Drizzle wraps driver failures in a
 * `DrizzleQueryError` whose own `message` is "Failed query: …" and which has no
 * `code` of its own; the `PostgresError` carrying `code` sits underneath in
 * `cause`. Reading `error.code` directly — which is what this function did
 * first — silently never matched, and the 409 above came out as a 500 with the
 * generic Norwegian sentence. That is the exact shape of bug that only an
 * integration test finds, and it did.
 */
function isUniqueViolation(error: unknown, depth = 0): boolean {
  if (depth > 5 || error === null || typeof error !== 'object') return false;
  if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) return true;
  return isUniqueViolation((error as { cause?: unknown }).cause, depth + 1);
}
