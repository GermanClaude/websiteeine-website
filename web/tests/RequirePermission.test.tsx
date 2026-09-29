import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { describe, expect, it, vi } from 'vitest';

import { Permission, permissionsForRole, type UserRole } from '@scpsl-trust/shared';

import { AuthContext, type AuthContextValue, type AuthStatus } from '../src/auth/AuthProvider';
import { RequirePermission } from '../src/auth/RequirePermission';
import { fakeSession } from './helpers';

function authValue(role: UserRole | null, overrides: Partial<AuthContextValue> = {}): AuthContextValue {
  const session = role === null ? null : fakeSession(role);
  const permissions = new Set<Permission>(role === null ? [] : permissionsForRole(role));
  const status: AuthStatus = role === null ? 'anonymous' : 'authenticated';
  return {
    status,
    session,
    user: session?.user ?? null,
    permissions,
    hasPermission: (permission) => permissions.has(permission),
    hasAnyPermission: (list) => list.some((permission) => permissions.has(permission)),
    hasAllPermissions: (list) => list.every((permission) => permissions.has(permission)),
    mfaEnrollmentRequired: false,
    mfaEnabled: false,
    csrfToken: session?.csrf_token ?? null,
    me: null,
    memberships: [],
    hasServerMembership: false,
    bootError: null,
    refresh: vi.fn(async () => undefined),
    setSession: vi.fn(),
    logout: vi.fn(async () => undefined),
    ...overrides,
  };
}

function renderGuard(auth: AuthContextValue, guard: ReactNode) {
  return render(
    <AuthContext.Provider value={auth}>
      <MemoryRouter initialEntries={['/guarded']}>
        <Routes>
          <Route path="/guarded" element={guard} />
          <Route path="/login" element={<div>Login page</div>} />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('RequirePermission', () => {
  it('renders children when the permission is granted', () => {
    renderGuard(
      authValue('admin'),
      <RequirePermission permission={Permission.AUDIT_VIEW}>
        <div>Audit content</div>
      </RequirePermission>,
    );
    expect(screen.getByText('Audit content')).toBeInTheDocument();
  });

  it('renders the Forbidden page when the permission is missing', () => {
    renderGuard(
      authValue('player'),
      <RequirePermission permission={Permission.AUDIT_VIEW}>
        <div>Audit content</div>
      </RequirePermission>,
    );
    expect(screen.queryByText('Audit content')).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Not permitted' })).toBeInTheDocument();
  });

  it('accepts any of several permissions', () => {
    renderGuard(
      authValue('reviewer'),
      <RequirePermission permission={[Permission.SERVER_MANAGE_ANY, Permission.CASE_VIEW_STAFF]}>
        <div>Cases</div>
      </RequirePermission>,
    );
    expect(screen.getByText('Cases')).toBeInTheDocument();
  });

  it('requires every permission in "all" mode', () => {
    renderGuard(
      authValue('reviewer'),
      <RequirePermission permission={[Permission.CASE_VIEW_STAFF, Permission.USER_MANAGE]} mode="all">
        <div>Both</div>
      </RequirePermission>,
    );
    expect(screen.queryByText('Both')).not.toBeInTheDocument();
  });

  it('honours the allowIf escape hatch (server membership)', () => {
    renderGuard(
      authValue('player', { hasServerMembership: true }),
      <RequirePermission permission={Permission.SERVER_MANAGE_ANY} allowIf={(auth) => auth.hasServerMembership}>
        <div>My servers</div>
      </RequirePermission>,
    );
    expect(screen.getByText('My servers')).toBeInTheDocument();
  });

  it('redirects anonymous visitors to the login page', () => {
    renderGuard(
      authValue(null),
      <RequirePermission permission={Permission.AUDIT_VIEW}>
        <div>Audit content</div>
      </RequirePermission>,
    );
    expect(screen.getByText('Login page')).toBeInTheDocument();
  });
});
