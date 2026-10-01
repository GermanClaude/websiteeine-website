/**
 * Sidebar navigation manifest. Visibility is a UI hint only — the backend enforces every
 * route (R10). Area agents add their entries to the matching section.
 */
import { Permission } from '@scpsl-trust/shared';

export interface NavContext {
  authenticated: boolean;
  permissions: ReadonlySet<Permission>;
  /** The user is a member (owner/admin/moderator) of at least one server team. */
  hasServerMembership: boolean;
}

export interface NavItem {
  label: string;
  to: string;
  /** Visible when the session has ANY of these permissions. */
  permission?: Permission | readonly Permission[];
  /** Additional OR condition. */
  visible?: (context: NavContext) => boolean;
  /** Visible without a session (public tools). */
  public?: boolean;
  /** Match the route exactly (for "/"). */
  end?: boolean;
}

export interface NavSection {
  title: string;
  items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: 'Overview',
    items: [{ label: 'Dashboard', to: '/', end: true }],
  },
  {
    title: 'Moderation',
    items: [
      // cases nav
      {
        label: 'Cases',
        to: '/cases',
        permission: Permission.CASE_VIEW_STAFF,
        visible: (context) => context.hasServerMembership,
      },
      // reports nav (everyone sees their own reports; report:review sees all)
      { label: 'Reports', to: '/reports' },
      // evidence nav
      { label: 'Evidence queue', to: '/evidence', permission: Permission.EVIDENCE_VIEW },
      // appeals nav (everyone sees their own appeals; appeal:decide sees all)
      { label: 'Appeals', to: '/appeals' },
      // players nav
      { label: 'Players', to: '/players', permission: Permission.PLAYER_VIEW_STAFF },
      // overwatch nav
      { label: 'Overwatch sessions', to: '/overwatch', permission: Permission.OVERWATCH_VIEW },
    ],
  },
  {
    title: 'Servers',
    items: [
      // servers nav
      {
        label: 'My servers',
        to: '/servers',
        permission: [Permission.SERVER_CREATE, Permission.SERVER_MANAGE_ANY],
        visible: (context) => context.hasServerMembership,
      },
      // whitelist nav (players request, server teams decide)
      { label: 'Whitelist requests', to: '/whitelist-requests' },
    ],
  },
  {
    title: 'Tools',
    items: [
      // tools nav
      { label: 'Proof verification', to: '/tools/proof', public: true },
      { label: 'Public case lookup', to: '/tools/case-lookup', public: true },
    ],
  },
  {
    title: 'Administration',
    items: [
      // admin nav
      { label: 'Users', to: '/admin/users', permission: Permission.USER_VIEW },
      { label: 'Audit log', to: '/admin/audit', permission: Permission.AUDIT_VIEW },
      { label: 'Global bypasses', to: '/admin/bypasses', permission: Permission.BYPASS_MANAGE_GLOBAL },
      { label: 'Security monitor', to: '/admin/security', permission: Permission.SECURITY_VIEW },
    ],
  },
  {
    title: 'Account',
    items: [
      { label: 'Profile', to: '/account', end: true },
      { label: 'Security', to: '/account/security' },
    ],
  },
];

export function isNavItemVisible(item: NavItem, context: NavContext): boolean {
  if (item.public === true) return true;
  if (!context.authenticated) return false;
  const hasPermission =
    item.permission === undefined
      ? false
      : typeof item.permission === 'string'
        ? context.permissions.has(item.permission)
        : item.permission.some((permission) => context.permissions.has(permission));
  if (item.permission === undefined && item.visible === undefined) return true;
  return hasPermission || (item.visible?.(context) ?? false);
}

/** Sections with only the visible items; empty sections are dropped. */
export function filterNav(sections: readonly NavSection[], context: NavContext): NavSection[] {
  return sections
    .map((section) => ({ title: section.title, items: section.items.filter((item) => isNavItemVisible(item, context)) }))
    .filter((section) => section.items.length > 0);
}

/** Label of the nav item matching a pathname (for the top bar). */
export function navLabelForPath(sections: readonly NavSection[], pathname: string): string | null {
  let best: NavItem | null = null;
  for (const section of sections) {
    for (const item of section.items) {
      const matches = item.end === true ? pathname === item.to : pathname === item.to || pathname.startsWith(`${item.to}/`);
      if (matches && (best === null || item.to.length > best.to.length)) best = item;
    }
  }
  return best?.label ?? null;
}
