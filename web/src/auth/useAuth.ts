import { useContext } from 'react';

import type { Permission } from '@scpsl-trust/shared';

import { AuthContext, type AuthContextValue } from './AuthProvider';

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) throw new Error('useAuth must be used within AuthProvider');
  return context;
}

/** True when the current session grants the permission (or any of the given ones). */
export function usePermission(permission: Permission | readonly Permission[]): boolean {
  const auth = useAuth();
  return typeof permission === 'string' ? auth.hasPermission(permission) : auth.hasAnyPermission(permission);
}
