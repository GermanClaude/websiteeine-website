/**
 * Role-based access control for web routes (ARCHITECTURE §12.3, R10).
 *
 * - requireAuth / requirePermission / requireVerifiedEmail: route preHandlers.
 * - requireServerRole: preHandler for `/servers/{id}/…` routes ({id} = public srv_ id);
 *   server-scoped actions are authorized by server-team membership, with optional
 *   override permissions (server:manage_any, whitelist:decide_any).
 * - assert*: the same checks for services.
 */
import type { FastifyReply, FastifyRequest, preHandlerAsyncHookHandler } from 'fastify';
import type { Kysely } from 'kysely';

import {
  hasPermission,
  SERVER_ID_REGEX,
  SERVER_MEMBER_ROLES_FOR,
  SERVER_SCOPED_PERMISSIONS,
  type Permission,
  type ServerMemberRole,
  type ServerScopedAction,
} from '@scpsl-trust/shared';

import type { DbExecutor } from '../db/tx';
import type { Database } from '../db/types';
import { AppError, forbidden, notFound, unauthenticated } from '../lib/errors';
import type { AuthenticatedSession, AuthenticatedUser, ServerAccess } from './types';

type PreHandler = (request: FastifyRequest, reply: FastifyReply) => Promise<void>;

/** Returns request.user or throws UNAUTHENTICATED / ACCOUNT_DISABLED. */
export function assertAuthenticated(request: FastifyRequest): AuthenticatedUser {
  const user = request.user;
  if (user === null || request.session === null) throw unauthenticated();
  if (user.status !== 'active') throw new AppError('ACCOUNT_DISABLED');
  return user;
}

/** Throws MFA_ENROLLMENT_REQUIRED when the session's role requires 2FA that is not enrolled. */
export function assertMfaEnrollment(session: AuthenticatedSession | null): void {
  if (session?.mfa_enrollment_required === true) throw new AppError('MFA_ENROLLMENT_REQUIRED');
}

/** Throws FORBIDDEN unless the user's role grants every permission. */
export function assertPermission(user: Pick<AuthenticatedUser, 'role'>, ...permissions: Permission[]): void {
  for (const permission of permissions) {
    if (!hasPermission(user.role, permission)) throw forbidden();
  }
}

/** Whether the user's role grants the permission (no throw). */
export function userHasPermission(user: Pick<AuthenticatedUser, 'role'> | null, permission: Permission): boolean {
  return user !== null && hasPermission(user.role, permission);
}

/** 401 without a valid session, 403 ACCOUNT_DISABLED for disabled accounts. */
export const requireAuth: preHandlerAsyncHookHandler = async function requireAuth(request) {
  assertAuthenticated(request);
};

/**
 * Authenticated + 2FA enrolled when required + every listed permission. Use on every
 * permission-protected route except /auth/* and /me (they use requireAuth only).
 */
export function requirePermission(...permissions: Permission[]): preHandlerAsyncHookHandler {
  const required = Object.freeze([...permissions]);
  const handler: PreHandler = async (request) => {
    const user = assertAuthenticated(request);
    assertMfaEnrollment(request.session);
    assertPermission(user, ...required);
  };
  return handler;
}

/** 403 EMAIL_NOT_VERIFIED unless the user's email is verified. */
export const requireVerifiedEmail: preHandlerAsyncHookHandler = async function requireVerifiedEmail(request) {
  const user = assertAuthenticated(request);
  if (!user.email_verified) throw new AppError('EMAIL_NOT_VERIFIED');
};

/** Requires a session that completed 2FA (e.g. verdicts, §11.2). */
export const requireMfaSession: preHandlerAsyncHookHandler = async function requireMfaSession(request) {
  assertAuthenticated(request);
  assertMfaEnrollment(request.session);
  if (request.session?.mfa_verified !== true) {
    throw new AppError('FORBIDDEN', 'This action requires a session verified with two-factor authentication');
  }
};

// ---------------------------------------------------------------------------
// Server-scoped access
// ---------------------------------------------------------------------------

/** Membership role of a user on a server (servers.id uuid), or null. */
export async function getServerMembership(db: DbExecutor, serverUuid: string, userId: string): Promise<ServerMemberRole | null> {
  const row = await db
    .selectFrom('server_members')
    .select('role')
    .where('server_id', '=', serverUuid)
    .where('user_id', '=', userId)
    .executeTakeFirst();
  return row?.role ?? null;
}

export interface ServerRoleCheckResult {
  member_role: ServerMemberRole | null;
  via: 'membership' | 'override';
}

/**
 * Authorizes a server-scoped action: an adequate membership role on that server, or the
 * override permission of the global role. Throws FORBIDDEN otherwise.
 */
export async function assertServerRole(
  db: DbExecutor,
  user: Pick<AuthenticatedUser, 'id' | 'role'>,
  serverUuid: string,
  roles: readonly ServerMemberRole[],
  overridePermission: Permission | null = null,
): Promise<ServerRoleCheckResult> {
  const memberRole = await getServerMembership(db, serverUuid, user.id);
  if (memberRole !== null && roles.includes(memberRole)) return { member_role: memberRole, via: 'membership' };
  if (overridePermission !== null && hasPermission(user.role, overridePermission)) {
    return { member_role: memberRole, via: 'override' };
  }
  throw forbidden();
}

/** assertServerRole with the member roles and override of a §12.3 scoped action. */
export function assertServerAction(
  db: DbExecutor,
  user: Pick<AuthenticatedUser, 'id' | 'role'>,
  serverUuid: string,
  action: ServerScopedAction,
): Promise<ServerRoleCheckResult> {
  return assertServerRole(db, user, serverUuid, SERVER_MEMBER_ROLES_FOR[action], SERVER_SCOPED_PERMISSIONS[action].override);
}

export interface RequireServerRoleOptions {
  /** Route param holding the public server id (default "id"). */
  param?: string;
  /** Member roles that grant access; alternatively `action` picks them from §12.3. */
  roles?: readonly ServerMemberRole[];
  action?: ServerScopedAction;
  /** Global permission that grants access without membership. */
  allowPermission?: Permission | null;
}

/**
 * preHandler for `/servers/:id/...`: resolves the public server id, authorizes the user and
 * sets request.serverAccess. Unknown ids → 404, insufficient access → 403.
 */
export function requireServerRole(db: Kysely<Database>, options: RequireServerRoleOptions): preHandlerAsyncHookHandler {
  const param = options.param ?? 'id';
  const roles = options.roles ?? (options.action !== undefined ? SERVER_MEMBER_ROLES_FOR[options.action] : undefined);
  if (roles === undefined) throw new TypeError('requireServerRole: roles or action is required');
  const override =
    options.allowPermission !== undefined
      ? options.allowPermission
      : options.action !== undefined
        ? SERVER_SCOPED_PERMISSIONS[options.action].override
        : null;

  const handler: PreHandler = async (request) => {
    const user = assertAuthenticated(request);
    assertMfaEnrollment(request.session);
    const params = (request.params ?? {}) as Record<string, unknown>;
    const publicId = params[param];
    if (typeof publicId !== 'string' || !SERVER_ID_REGEX.test(publicId)) throw notFound('Server not found');
    const server = await db
      .selectFrom('servers')
      .select(['id', 'server_id', 'name', 'status', 'owner_user_id', 'is_trusted'])
      .where('server_id', '=', publicId)
      .executeTakeFirst();
    if (server === undefined) throw notFound('Server not found');
    const result = await assertServerRole(db, user, server.id, roles, override);
    const access: ServerAccess = { server, member_role: result.member_role, via: result.via };
    request.serverAccess = access;
  };
  return handler;
}
