import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import type { Permission } from '@scpsl-trust/shared';

import { LoadingScreen } from '../components/Spinner';
import { ForbiddenPage } from '../pages/errors/ForbiddenPage';
import type { AuthContextValue } from './AuthProvider';
import { useAuth } from './useAuth';

export interface RequirePermissionProps {
  /** One permission, or a list (see `mode`). */
  permission?: Permission | readonly Permission[];
  /** `any` (default): at least one of the listed permissions; `all`: every one. */
  mode?: 'any' | 'all';
  /** Extra OR condition, e.g. `(auth) => auth.hasServerMembership` for membership-scoped areas. */
  allowIf?: (auth: AuthContextValue) => boolean;
  /** Rendered instead of the Forbidden page. */
  fallback?: ReactNode;
  children?: ReactNode;
}

/** Guards a page (or a route subtree via `<Outlet/>`) by permission — the backend still enforces (R10). */
export function RequirePermission({ permission, mode = 'any', allowIf, fallback, children }: RequirePermissionProps) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <LoadingScreen />;
  if (auth.status === 'anonymous') {
    return <Navigate to="/login" replace state={{ from: `${location.pathname}${location.search}` }} />;
  }

  let allowed = permission === undefined;
  if (permission !== undefined) {
    const list = typeof permission === 'string' ? [permission] : permission;
    allowed = mode === 'all' ? auth.hasAllPermissions(list) : auth.hasAnyPermission(list);
  }
  if (!allowed && allowIf !== undefined) allowed = allowIf(auth);

  if (!allowed) return <>{fallback ?? <ForbiddenPage />}</>;
  return <>{children ?? <Outlet />}</>;
}
