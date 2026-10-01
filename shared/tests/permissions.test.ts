import { describe, expect, it } from 'vitest';
import {
  canActOnServer,
  canAssignRole,
  canChangeUserRole,
  canManageUser,
  caseStaffScope,
  DEFAULT_REQUIRE_2FA_ROLES,
  hasAllPermissions,
  hasAnyPermission,
  hasPermission,
  hasServerMemberRole,
  isPermission,
  Permission,
  PERMISSIONS,
  permissionsForRole,
  ROLE_PERMISSIONS,
  SERVER_MEMBER_ROLES_FOR,
  USER_ROLES,
  type UserRole,
} from '../src';

/** §12.3 matrix, one row per group. */
const MATRIX: Array<{ permissions: string[]; roles: UserRole[] }> = [
  {
    permissions: ['case:view_public', 'report:create', 'appeal:create', 'whitelist:request', 'player:link'],
    roles: ['player', 'server_admin', 'reviewer', 'moderator', 'admin', 'super_admin'],
  },
  {
    permissions: ['server:create', 'server:manage', 'policy:manage', 'bypass:manage', 'whitelist:decide', 'case:confirm_for_server'],
    roles: ['server_admin', 'admin', 'super_admin'],
  },
  {
    permissions: ['case:view_staff'],
    roles: ['server_admin', 'reviewer', 'moderator', 'admin', 'super_admin'],
  },
  {
    permissions: [
      'case:review',
      'case:set_verdict',
      'evidence:view',
      'evidence:download',
      'evidence:review',
      'evidence:upload',
      'report:review',
      'appeal:decide',
      'player:view_staff',
      'overwatch:view',
      'proof:view_code',
      'dashboard:staff',
    ],
    roles: ['reviewer', 'moderator', 'admin', 'super_admin'],
  },
  {
    permissions: ['case:create', 'case:reopen', 'report:manage', 'appeal:assign', 'whitelist:decide_any', 'user:view'],
    roles: ['moderator', 'admin', 'super_admin'],
  },
  {
    permissions: [
      'user:manage',
      'server:manage_any',
      'server:trust',
      'audit:view',
      'audit:verify',
      'bypass:manage_global',
      'security:view',
      'security:manage',
    ],
    roles: ['admin', 'super_admin'],
  },
  {
    permissions: ['user:manage_admins', 'appeal:override_conflict'],
    roles: ['super_admin'],
  },
];

describe('permission catalogue', () => {
  it('contains exactly the §12.3 permissions', () => {
    const expected = new Set(MATRIX.flatMap((row) => row.permissions));
    expect(new Set(PERMISSIONS)).toEqual(expected);
    expect(PERMISSIONS).toHaveLength(expected.size);
    for (const permission of PERMISSIONS) expect(permission).toMatch(/^[a-z]+:[a-z_]+$/);
  });

  it('isPermission', () => {
    expect(isPermission('case:view_staff')).toBe(true);
    expect(isPermission('case:VIEW_STAFF')).toBe(false);
    expect(isPermission('admin')).toBe(false);
    expect(isPermission(42)).toBe(false);
  });
});

describe('role → permission matrix', () => {
  it.each(MATRIX.flatMap((row) => row.permissions.flatMap((p) => USER_ROLES.map((role) => [p, role, row.roles.includes(role)] as const))))(
    '%s for %s = %s',
    (permission, role, granted) => {
      expect(hasPermission(role, permission as Permission)).toBe(granted);
    },
  );

  it('server_admin gets no reviewer permissions, reviewers get no server operation', () => {
    expect(hasPermission('server_admin', Permission.CASE_SET_VERDICT)).toBe(false);
    expect(hasPermission('server_admin', Permission.EVIDENCE_VIEW)).toBe(false);
    expect(hasPermission('server_admin', Permission.PROOF_VIEW_CODE)).toBe(false);
    expect(hasPermission('reviewer', Permission.SERVER_CREATE)).toBe(false);
    expect(hasPermission('moderator', Permission.POLICY_MANAGE)).toBe(false);
    expect(hasPermission('moderator', Permission.AUDIT_VIEW)).toBe(false);
    expect(hasPermission('admin', Permission.USER_MANAGE_ADMINS)).toBe(false);
    expect(hasPermission('admin', Permission.APPEAL_OVERRIDE_CONFLICT)).toBe(false);
  });

  it('super_admin has every permission; player only the base five', () => {
    expect(permissionsForRole('super_admin')).toEqual(PERMISSIONS);
    expect(permissionsForRole('player')).toEqual(['case:view_public', 'report:create', 'appeal:create', 'whitelist:request', 'player:link']);
  });

  it('lists are deduplicated, catalogue-ordered and frozen', () => {
    for (const role of USER_ROLES) {
      const list = ROLE_PERMISSIONS[role];
      expect(new Set(list).size).toBe(list.length);
      expect([...list]).toEqual(PERMISSIONS.filter((p) => list.includes(p)));
      expect(Object.isFrozen(list)).toBe(true);
    }
    expect(Object.isFrozen(ROLE_PERMISSIONS)).toBe(true);
  });

  it('unknown roles grant nothing', () => {
    const forged = 'root' as UserRole;
    expect(hasPermission(forged, Permission.CASE_VIEW_PUBLIC)).toBe(false);
    expect(permissionsForRole(forged)).toEqual([]);
    expect(canAssignRole(forged, 'player')).toBe(false);
  });

  it('hasAll / hasAny', () => {
    expect(hasAllPermissions('reviewer', [Permission.CASE_REVIEW, Permission.EVIDENCE_VIEW])).toBe(true);
    expect(hasAllPermissions('reviewer', [Permission.CASE_REVIEW, Permission.CASE_CREATE])).toBe(false);
    expect(hasAnyPermission('player', [Permission.CASE_REVIEW, Permission.REPORT_CREATE])).toBe(true);
    expect(hasAnyPermission('player', [Permission.CASE_REVIEW])).toBe(false);
  });
});

describe('role assignment', () => {
  it('admins assign up to moderator, super_admins everything, others nothing', () => {
    for (const target of USER_ROLES) {
      expect(canAssignRole('super_admin', target)).toBe(true);
      expect(canAssignRole('admin', target)).toBe(['player', 'server_admin', 'reviewer', 'moderator'].includes(target));
      for (const actor of ['player', 'server_admin', 'reviewer', 'moderator'] as const) {
        expect(canAssignRole(actor, target)).toBe(false);
      }
    }
  });

  it('an admin cannot demote or manage another admin or a super_admin', () => {
    expect(canChangeUserRole('admin', 'admin', 'player')).toBe(false);
    expect(canChangeUserRole('admin', 'super_admin', 'moderator')).toBe(false);
    expect(canChangeUserRole('admin', 'reviewer', 'admin')).toBe(false);
    expect(canChangeUserRole('admin', 'player', 'moderator')).toBe(true);
    expect(canChangeUserRole('super_admin', 'admin', 'player')).toBe(true);
    expect(canManageUser('admin', 'admin')).toBe(false);
    expect(canManageUser('admin', 'reviewer')).toBe(true);
    expect(canManageUser('moderator', 'player')).toBe(false);
  });
});

describe('server-scoped checks', () => {
  it('member roles per action', () => {
    expect(SERVER_MEMBER_ROLES_FOR.whitelist_decide).toEqual(['owner', 'admin', 'moderator']);
    for (const action of ['manage', 'policy', 'bypass', 'confirm'] as const) {
      expect(SERVER_MEMBER_ROLES_FOR[action]).toEqual(['owner', 'admin']);
      expect(hasServerMemberRole('moderator', action)).toBe(false);
    }
    expect(hasServerMemberRole('moderator', 'whitelist_decide')).toBe(true);
    expect(hasServerMemberRole(null, 'manage')).toBe(false);
    expect(hasServerMemberRole(undefined, 'whitelist_decide')).toBe(false);
  });

  it('canActOnServer combines global permission, membership and overrides', () => {
    expect(canActOnServer('server_admin', 'owner', 'manage')).toBe(true);
    expect(canActOnServer('server_admin', 'moderator', 'manage')).toBe(false);
    expect(canActOnServer('server_admin', null, 'policy')).toBe(false);
    expect(canActOnServer('server_admin', 'moderator', 'whitelist_decide')).toBe(true);
    // Membership is sufficient whatever the global role (a server owner may add players
    // and reviewers to the server team).
    expect(canActOnServer('player', 'owner', 'manage')).toBe(true);
    expect(canActOnServer('player', 'moderator', 'whitelist_decide')).toBe(true);
    expect(canActOnServer('player', 'moderator', 'manage')).toBe(false);
    expect(canActOnServer('player', null, 'manage')).toBe(false);
    expect(canActOnServer('reviewer', 'admin', 'bypass')).toBe(true);
    expect(canActOnServer('reviewer', null, 'bypass')).toBe(false);
    // Overrides.
    expect(canActOnServer('admin', null, 'manage')).toBe(true);
    expect(canActOnServer('admin', null, 'policy')).toBe(true);
    expect(canActOnServer('moderator', null, 'whitelist_decide')).toBe(true);
    // Confirmations have no override: they must come from the server's own members.
    expect(canActOnServer('super_admin', null, 'confirm')).toBe(false);
    expect(canActOnServer('super_admin', 'admin', 'confirm')).toBe(true);
    expect(canActOnServer('server_admin', 'moderator', 'confirm')).toBe(false);
  });

  it('caseStaffScope', () => {
    expect(caseStaffScope('player')).toBe('none');
    expect(caseStaffScope('player', true)).toBe('own_servers');
    expect(caseStaffScope('server_admin')).toBe('own_servers');
    expect(caseStaffScope('reviewer')).toBe('all');
    expect(caseStaffScope('reviewer', true)).toBe('all');
    expect(caseStaffScope('super_admin')).toBe('all');
  });

  it('default 2FA roles', () => {
    expect(DEFAULT_REQUIRE_2FA_ROLES).toEqual(['reviewer', 'moderator', 'admin', 'super_admin']);
  });
});
