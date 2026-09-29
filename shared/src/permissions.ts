/**
 * Permission catalogue and role → permission matrix (ARCHITECTURE §12.3).
 * The backend enforces these on every route (R10); the web only uses them to hide UI.
 */
import { z } from 'zod';
import { roleRank, UserRole, USER_ROLES, type ServerMemberRole } from './enums';

export const Permission = {
  // Everyone (incl. player)
  CASE_VIEW_PUBLIC: 'case:view_public',
  REPORT_CREATE: 'report:create',
  APPEAL_CREATE: 'appeal:create',
  WHITELIST_REQUEST: 'whitelist:request',
  PLAYER_LINK: 'player:link',
  // Server operators (scoped to own server memberships)
  SERVER_CREATE: 'server:create',
  SERVER_MANAGE: 'server:manage',
  POLICY_MANAGE: 'policy:manage',
  BYPASS_MANAGE: 'bypass:manage',
  WHITELIST_DECIDE: 'whitelist:decide',
  CASE_CONFIRM_FOR_SERVER: 'case:confirm_for_server',
  // Review staff (server_admin gets case:view_staff limited to own servers)
  CASE_VIEW_STAFF: 'case:view_staff',
  CASE_REVIEW: 'case:review',
  CASE_SET_VERDICT: 'case:set_verdict',
  EVIDENCE_VIEW: 'evidence:view',
  EVIDENCE_DOWNLOAD: 'evidence:download',
  EVIDENCE_REVIEW: 'evidence:review',
  EVIDENCE_UPLOAD: 'evidence:upload',
  REPORT_REVIEW: 'report:review',
  APPEAL_DECIDE: 'appeal:decide',
  PLAYER_VIEW_STAFF: 'player:view_staff',
  OVERWATCH_VIEW: 'overwatch:view',
  PROOF_VIEW_CODE: 'proof:view_code',
  DASHBOARD_STAFF: 'dashboard:staff',
  // Moderation
  CASE_CREATE: 'case:create',
  CASE_REOPEN: 'case:reopen',
  REPORT_MANAGE: 'report:manage',
  APPEAL_ASSIGN: 'appeal:assign',
  WHITELIST_DECIDE_ANY: 'whitelist:decide_any',
  USER_VIEW: 'user:view',
  // Administration
  USER_MANAGE: 'user:manage',
  SERVER_MANAGE_ANY: 'server:manage_any',
  SERVER_TRUST: 'server:trust',
  AUDIT_VIEW: 'audit:view',
  AUDIT_VERIFY: 'audit:verify',
  BYPASS_MANAGE_GLOBAL: 'bypass:manage_global',
  // Super admin
  USER_MANAGE_ADMINS: 'user:manage_admins',
  APPEAL_OVERRIDE_CONFLICT: 'appeal:override_conflict',
} as const;
export type Permission = (typeof Permission)[keyof typeof Permission];
export const PERMISSIONS = Object.freeze(Object.values(Permission)) as unknown as [Permission, ...Permission[]];
export const PermissionSchema = z.enum(PERMISSIONS);

export function isPermission(value: unknown): value is Permission {
  return typeof value === 'string' && (PERMISSIONS as readonly string[]).includes(value);
}

// Rows of the §12.3 matrix.
const BASE: readonly Permission[] = [
  Permission.CASE_VIEW_PUBLIC,
  Permission.REPORT_CREATE,
  Permission.APPEAL_CREATE,
  Permission.WHITELIST_REQUEST,
  Permission.PLAYER_LINK,
];
const SERVER_OPERATION: readonly Permission[] = [
  Permission.SERVER_CREATE,
  Permission.SERVER_MANAGE,
  Permission.POLICY_MANAGE,
  Permission.BYPASS_MANAGE,
  Permission.WHITELIST_DECIDE,
  Permission.CASE_CONFIRM_FOR_SERVER,
  Permission.CASE_VIEW_STAFF,
];
const REVIEW: readonly Permission[] = [
  Permission.CASE_VIEW_STAFF,
  Permission.CASE_REVIEW,
  Permission.CASE_SET_VERDICT,
  Permission.EVIDENCE_VIEW,
  Permission.EVIDENCE_DOWNLOAD,
  Permission.EVIDENCE_REVIEW,
  Permission.EVIDENCE_UPLOAD,
  Permission.REPORT_REVIEW,
  Permission.APPEAL_DECIDE,
  Permission.PLAYER_VIEW_STAFF,
  Permission.OVERWATCH_VIEW,
  Permission.PROOF_VIEW_CODE,
  Permission.DASHBOARD_STAFF,
];
const MODERATION: readonly Permission[] = [
  Permission.CASE_CREATE,
  Permission.CASE_REOPEN,
  Permission.REPORT_MANAGE,
  Permission.APPEAL_ASSIGN,
  Permission.WHITELIST_DECIDE_ANY,
  Permission.USER_VIEW,
];
const ADMINISTRATION: readonly Permission[] = [
  Permission.USER_MANAGE,
  Permission.SERVER_MANAGE_ANY,
  Permission.SERVER_TRUST,
  Permission.AUDIT_VIEW,
  Permission.AUDIT_VERIFY,
  Permission.BYPASS_MANAGE_GLOBAL,
];
const SUPER_ADMINISTRATION: readonly Permission[] = [
  Permission.USER_MANAGE_ADMINS,
  Permission.APPEAL_OVERRIDE_CONFLICT,
];

/** Deduplicated, catalogue-ordered, frozen permission list. */
function combine(...groups: ReadonlyArray<readonly Permission[]>): readonly Permission[] {
  const set = new Set<Permission>(groups.flat());
  return Object.freeze(PERMISSIONS.filter((permission) => set.has(permission)));
}

/**
 * Role → permissions (§12.3). Not strictly cumulative: server_admin has no review
 * permissions and reviewer/moderator have no server-operation permissions.
 */
export const ROLE_PERMISSIONS: Readonly<Record<UserRole, readonly Permission[]>> = Object.freeze({
  player: combine(BASE),
  server_admin: combine(BASE, SERVER_OPERATION),
  reviewer: combine(BASE, REVIEW),
  moderator: combine(BASE, REVIEW, MODERATION),
  admin: combine(BASE, SERVER_OPERATION, REVIEW, MODERATION, ADMINISTRATION),
  super_admin: combine(BASE, SERVER_OPERATION, REVIEW, MODERATION, ADMINISTRATION, SUPER_ADMINISTRATION),
});

const ROLE_PERMISSION_SETS: ReadonlyMap<string, ReadonlySet<Permission>> = new Map(
  USER_ROLES.map((role) => [role, new Set(ROLE_PERMISSIONS[role])]),
);

/** True when `role` grants `permission`. Unknown roles grant nothing. */
export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSION_SETS.get(role)?.has(permission) ?? false;
}

export function hasAllPermissions(role: UserRole, permissions: readonly Permission[]): boolean {
  return permissions.every((permission) => hasPermission(role, permission));
}

export function hasAnyPermission(role: UserRole, permissions: readonly Permission[]): boolean {
  return permissions.some((permission) => hasPermission(role, permission));
}

/** Permissions of a role in catalogue order (empty for unknown roles). */
export function permissionsForRole(role: UserRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role] ?? [];
}

/**
 * Whether an actor may assign `targetRole` to someone:
 * `user:manage` allows roles up to moderator, `user:manage_admins` allows every role.
 */
export function canAssignRole(actorRole: UserRole, targetRole: UserRole): boolean {
  const targetRank = roleRank(targetRole);
  if (targetRank < 0) return false;
  if (hasPermission(actorRole, Permission.USER_MANAGE_ADMINS)) return true;
  if (hasPermission(actorRole, Permission.USER_MANAGE)) return targetRank <= roleRank(UserRole.MODERATOR);
  return false;
}

/** Whether an actor may manage (status, sessions) a user who currently has `targetCurrentRole`. */
export function canManageUser(actorRole: UserRole, targetCurrentRole: UserRole): boolean {
  return canAssignRole(actorRole, targetCurrentRole);
}

/** Role change is allowed only if the actor may manage both the current and the new role. */
export function canChangeUserRole(actorRole: UserRole, currentRole: UserRole, newRole: UserRole): boolean {
  return canAssignRole(actorRole, currentRole) && canAssignRole(actorRole, newRole);
}

/**
 * Case staff access: reviewers+ see all cases; server operators (server_admin role, or any
 * user who is a member of at least one server team) only see cases their servers reported
 * or confirmed.
 */
export type CaseStaffScope = 'all' | 'own_servers' | 'none';
export function caseStaffScope(role: UserRole, hasServerMembership = false): CaseStaffScope {
  if (hasPermission(role, Permission.CASE_REVIEW)) return 'all';
  if (hasPermission(role, Permission.CASE_VIEW_STAFF) || hasServerMembership) return 'own_servers';
  return 'none';
}

// ---------------------------------------------------------------------------
// Server-scoped checks (§12.3 "own")
// ---------------------------------------------------------------------------

export type ServerScopedAction = 'manage' | 'policy' | 'bypass' | 'confirm' | 'whitelist_decide';

/** Member roles that satisfy the "own server" part of each scoped permission. */
export const SERVER_MEMBER_ROLES_FOR: Readonly<Record<ServerScopedAction, readonly ServerMemberRole[]>> =
  Object.freeze({
    manage: Object.freeze(['owner', 'admin'] as const),
    policy: Object.freeze(['owner', 'admin'] as const),
    bypass: Object.freeze(['owner', 'admin'] as const),
    confirm: Object.freeze(['owner', 'admin'] as const),
    whitelist_decide: Object.freeze(['owner', 'admin', 'moderator'] as const),
  });

/**
 * The "own server" permission each scoped action corresponds to (used by the web panel to
 * decide which navigation to show), plus the optional permission that grants the action on
 * every server without membership. Confirmations have no override: they are statements of
 * the server itself and must come from its members.
 *
 * Authorization for scoped actions is decided by server-team membership (§12.3): a member
 * with an adequate member role may act on that server whatever their global role is, so
 * a server owner can add moderators who only hold the `player` role. The global role only
 * matters for the override permissions and for creating servers (`server:create`).
 */
export const SERVER_SCOPED_PERMISSIONS: Readonly<
  Record<ServerScopedAction, { readonly permission: Permission; readonly override: Permission | null }>
> = Object.freeze({
  manage: { permission: Permission.SERVER_MANAGE, override: Permission.SERVER_MANAGE_ANY },
  policy: { permission: Permission.POLICY_MANAGE, override: Permission.SERVER_MANAGE_ANY },
  bypass: { permission: Permission.BYPASS_MANAGE, override: Permission.SERVER_MANAGE_ANY },
  confirm: { permission: Permission.CASE_CONFIRM_FOR_SERVER, override: null },
  whitelist_decide: { permission: Permission.WHITELIST_DECIDE, override: Permission.WHITELIST_DECIDE_ANY },
});

/** True when the member role (null = not a member) is adequate for the scoped action. */
export function hasServerMemberRole(
  memberRole: ServerMemberRole | null | undefined,
  action: ServerScopedAction,
): boolean {
  if (memberRole === null || memberRole === undefined) return false;
  return SERVER_MEMBER_ROLES_FOR[action].includes(memberRole);
}

/**
 * Full scoped check: override permission (global role), or an adequate membership on that
 * server. Membership alone is sufficient — see SERVER_SCOPED_PERMISSIONS.
 */
export function canActOnServer(
  role: UserRole,
  memberRole: ServerMemberRole | null | undefined,
  action: ServerScopedAction,
): boolean {
  const { override } = SERVER_SCOPED_PERMISSIONS[action];
  if (override !== null && hasPermission(role, override)) return true;
  return hasServerMemberRole(memberRole, action);
}

/** Default REQUIRE_2FA_ROLES (§12.2). */
export const DEFAULT_REQUIRE_2FA_ROLES: readonly UserRole[] = Object.freeze([
  UserRole.REVIEWER,
  UserRole.MODERATOR,
  UserRole.ADMIN,
  UserRole.SUPER_ADMIN,
]);
