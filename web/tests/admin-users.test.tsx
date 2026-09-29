import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { USER_ROLES, permissionsForRole, type Permission, type UserRole } from '@scpsl-trust/shared';

import { NAV_SECTIONS, filterNav } from '../src/nav';
import { UserEditModal, assignableRoles } from '../src/pages/admin/UserEditModal';
import { fakeAdminUser } from './area-fixtures';
import { USER_ID, renderWithProviders } from './helpers';

describe('assignableRoles', () => {
  it('limits admins (user:manage) to roles up to moderator', () => {
    expect(assignableRoles('admin', 'player')).toEqual(['player', 'server_admin', 'reviewer', 'moderator']);
  });

  it('gives moderators (user:view only) no assignable role', () => {
    expect(assignableRoles('moderator', 'player')).toEqual(['player']);
  });

  it('lets super_admins assign every role', () => {
    expect(assignableRoles('super_admin', 'player')).toEqual([...USER_ROLES]);
  });

  it('never lets an admin touch a super_admin', () => {
    expect(assignableRoles('admin', 'super_admin')).toEqual(['super_admin']);
    expect(assignableRoles('reviewer', 'player')).toEqual(['player']);
  });
});

describe('UserEditModal', () => {
  it('disables options above the actor scope for an admin', () => {
    renderWithProviders(<UserEditModal user={fakeAdminUser()} actorRole="admin" actorId={USER_ID} onClose={() => undefined} />);
    const select = screen.getByLabelText('Role');
    const options = within(select).getAllByRole('option') as HTMLOptionElement[];
    const disabled = options.filter((option) => option.disabled).map((option) => option.value);
    expect(disabled).toEqual(['admin', 'super_admin']);
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeEnabled();
  });

  it('is read-only for a moderator and for an admin editing a super_admin', () => {
    const { rerender } = renderWithProviders(<UserEditModal user={fakeAdminUser()} actorRole="moderator" actorId={USER_ID} onClose={() => undefined} />);
    expect(screen.getByLabelText('Role')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
    rerender(<UserEditModal user={fakeAdminUser({ role: 'super_admin' })} actorRole="admin" actorId={USER_ID} onClose={() => undefined} />);
    expect(screen.getByLabelText('Role')).toBeDisabled();
    expect(screen.getByText(/their current role is above what you may manage/)).toBeInTheDocument();
  });

  it('enables every role for a super_admin', () => {
    renderWithProviders(<UserEditModal user={fakeAdminUser()} actorRole="super_admin" actorId={USER_ID} onClose={() => undefined} />);
    const select = screen.getByLabelText('Role');
    const options = within(select).getAllByRole('option') as HTMLOptionElement[];
    expect(options.every((option) => !option.disabled)).toBe(true);
  });
});

describe('administration navigation', () => {
  function labels(role: UserRole): string[] {
    return filterNav(NAV_SECTIONS, { authenticated: true, permissions: new Set<Permission>(permissionsForRole(role)), hasServerMembership: false }).flatMap((section) =>
      section.items.map((item) => item.label),
    );
  }

  it('hides admin entries from non-admins and shows them to admins', () => {
    for (const role of ['player', 'server_admin', 'reviewer'] as const) {
      const visible = labels(role);
      expect(visible).not.toContain('Audit log');
      expect(visible).not.toContain('Global bypasses');
      expect(visible).not.toContain('Users');
    }
    expect(labels('moderator')).toContain('Users');
    expect(labels('moderator')).not.toContain('Audit log');
    for (const label of ['Users', 'Audit log', 'Global bypasses']) {
      expect(labels('admin')).toContain(label);
      expect(labels('super_admin')).toContain(label);
    }
  });
});
