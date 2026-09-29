/**
 * Presentation helpers for server pages.
 */
import { SERVER_MEMBER_ROLES_FOR, canActOnServer, type ServerMemberRole, type ServerScopedAction, type UserRole } from '@scpsl-trust/shared';

/** A server is "online" when the plugin has been seen recently (heartbeat is 60 s by default). */
export const ONLINE_WINDOW_MS = 3 * 60 * 1000;

export function isServerOnline(lastSeenAt: string | null | undefined, now: number = Date.now()): boolean {
  if (lastSeenAt === null || lastSeenAt === undefined) return false;
  const seen = Date.parse(lastSeenAt);
  return Number.isFinite(seen) && now - seen <= ONLINE_WINDOW_MS;
}

export interface ServerAbilities {
  manage: boolean;
  policy: boolean;
  bypass: boolean;
  confirm: boolean;
  whitelistDecide: boolean;
}

/** Per-server abilities from the caller's global role and the membership role returned in the view. */
export function serverAbilities(role: UserRole | null | undefined, memberRole: ServerMemberRole | null | undefined): ServerAbilities {
  const check = (action: ServerScopedAction): boolean => (role === null || role === undefined ? false : canActOnServer(role, memberRole, action));
  return {
    manage: check('manage'),
    policy: check('policy'),
    bypass: check('bypass'),
    confirm: check('confirm'),
    whitelistDecide: check('whitelist_decide'),
  };
}

/** Human description of which member roles may perform a scoped action (for hints). */
export function memberRolesLabel(action: ServerScopedAction): string {
  return SERVER_MEMBER_ROLES_FOR[action].join(' / ');
}
