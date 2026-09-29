import { describe, expect, it } from 'vitest';

import { permissionsForRole, type Permission, type UserRole } from '@scpsl-trust/shared';

import { NAV_SECTIONS, filterNav, navLabelForPath, type NavContext } from '../src/nav';

function contextFor(role: UserRole | null, hasServerMembership = false): NavContext {
  return {
    authenticated: role !== null,
    permissions: new Set<Permission>(role === null ? [] : permissionsForRole(role)),
    hasServerMembership,
  };
}

function labels(context: NavContext): string[] {
  return filterNav(NAV_SECTIONS, context).flatMap((section) => section.items.map((item) => item.label));
}

describe('nav filtering', () => {
  it('shows only public tools to anonymous visitors', () => {
    expect(labels(contextFor(null))).toEqual(['Proof verification', 'Public case lookup']);
  });

  it('hides staff and admin entries from players', () => {
    const visible = labels(contextFor('player'));
    expect(visible).toContain('Dashboard');
    expect(visible).toContain('Reports');
    expect(visible).toContain('Appeals');
    expect(visible).toContain('Whitelist requests');
    expect(visible).toContain('Profile');
    expect(visible).not.toContain('Cases');
    expect(visible).not.toContain('Players');
    expect(visible).not.toContain('My servers');
    expect(visible).not.toContain('Users');
    expect(visible).not.toContain('Audit log');
    expect(visible).not.toContain('Global bypasses');
  });

  it('shows server entries to players with a server membership', () => {
    const visible = labels(contextFor('player', true));
    expect(visible).toContain('My servers');
    expect(visible).toContain('Cases');
    expect(visible).not.toContain('Users');
  });

  it('shows moderation entries to reviewers but no administration', () => {
    const visible = labels(contextFor('reviewer'));
    expect(visible).toEqual(expect.arrayContaining(['Cases', 'Evidence queue', 'Players', 'Overwatch sessions']));
    expect(visible).not.toContain('My servers');
    expect(visible).not.toContain('Users');
    expect(visible).not.toContain('Audit log');
    expect(filterNav(NAV_SECTIONS, contextFor('reviewer')).map((section) => section.title)).not.toContain('Administration');
  });

  it('shows everything to admins', () => {
    const visible = labels(contextFor('admin'));
    for (const label of ['Dashboard', 'Cases', 'Reports', 'Evidence queue', 'Appeals', 'Players', 'Overwatch sessions', 'My servers', 'Whitelist requests', 'Users', 'Audit log', 'Global bypasses', 'Profile', 'Security']) {
      expect(visible).toContain(label);
    }
  });

  it('drops empty sections', () => {
    const sections = filterNav(NAV_SECTIONS, contextFor('player'));
    expect(sections.every((section) => section.items.length > 0)).toBe(true);
  });

  it('resolves the label of the most specific matching item', () => {
    expect(navLabelForPath(NAV_SECTIONS, '/')).toBe('Dashboard');
    expect(navLabelForPath(NAV_SECTIONS, '/account/security')).toBe('Security');
    expect(navLabelForPath(NAV_SECTIONS, '/cases/CASE-2026-000001')).toBe('Cases');
    expect(navLabelForPath(NAV_SECTIONS, '/nowhere')).toBeNull();
  });
});
