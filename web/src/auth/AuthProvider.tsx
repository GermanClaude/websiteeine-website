/**
 * Session state for the whole app. Loads `GET /auth/session` on start, keeps the CSRF token
 * in the API client, exposes permissions (from the session, never derived client-side from
 * the role) and the user's server memberships (from `GET /me`), and resets on any 401.
 */
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useEffect, useMemo, type ReactNode } from 'react';

import type { AuthSessionResponse, MeResponse, MeServerMembership, Permission, SessionUser } from '@scpsl-trust/shared';

import { getSession, logout as apiLogout } from '../api/auth';
import { ApiError, authEvents, clearCsrfToken, setCsrfToken } from '../api/client';
import { authKeys, meKeys } from '../api/keys';
import { getMe } from '../api/me';

export type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  session: AuthSessionResponse | null;
  user: SessionUser | null;
  /** Permissions granted by the backend for this session. */
  permissions: ReadonlySet<Permission>;
  hasPermission: (permission: Permission) => boolean;
  hasAnyPermission: (permissions: readonly Permission[]) => boolean;
  hasAllPermissions: (permissions: readonly Permission[]) => boolean;
  /** Role requires 2FA but none is enrolled: only /auth/* and /me work (§12.2). */
  mfaEnrollmentRequired: boolean;
  mfaEnabled: boolean;
  csrfToken: string | null;
  /** Profile from GET /me (null until loaded). */
  me: MeResponse | null;
  memberships: readonly MeServerMembership[];
  hasServerMembership: boolean;
  /** Non-401 failure of the initial session load (e.g. network down). */
  bootError: unknown;
  /** Re-fetch the session and the profile. */
  refresh: () => Promise<void>;
  /** Install a session returned by login / 2FA. */
  setSession: (session: AuthSessionResponse) => void;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

const EMPTY_PERMISSIONS: ReadonlySet<Permission> = new Set();
const NO_MEMBERSHIPS: readonly MeServerMembership[] = [];

async function loadSession(): Promise<AuthSessionResponse | null> {
  try {
    return await getSession();
  } catch (error) {
    if (ApiError.is(error) && error.status === 401) return null;
    throw error;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  const sessionQuery = useQuery({
    queryKey: authKeys.session,
    queryFn: loadSession,
    staleTime: Number.POSITIVE_INFINITY,
    gcTime: Number.POSITIVE_INFINITY,
    retry: false,
    refetchOnWindowFocus: false,
  });

  const session = sessionQuery.data ?? null;
  const authenticated = session !== null;

  const meQuery = useQuery({
    queryKey: meKeys.profile,
    queryFn: getMe,
    enabled: authenticated,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (session !== null) setCsrfToken(session.csrf_token);
  }, [session]);

  // Any 401 anywhere: drop the session and every cached query of the previous user.
  useEffect(
    () =>
      authEvents.onUnauthenticated(() => {
        const current = queryClient.getQueryData<AuthSessionResponse | null>(authKeys.session);
        if (current === null || current === undefined) return;
        queryClient.setQueryData<AuthSessionResponse | null>(authKeys.session, null);
        queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== authKeys.all[0] });
      }),
    [queryClient],
  );

  const setSession = useCallback(
    (next: AuthSessionResponse) => {
      setCsrfToken(next.csrf_token);
      queryClient.setQueryData<AuthSessionResponse | null>(authKeys.session, next);
      void queryClient.invalidateQueries({ queryKey: meKeys.all });
    },
    [queryClient],
  );

  const refresh = useCallback(async () => {
    await queryClient.refetchQueries({ queryKey: authKeys.session });
    await queryClient.invalidateQueries({ queryKey: meKeys.all });
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await apiLogout();
    } catch {
      /* the session is dropped locally regardless */
    }
    clearCsrfToken();
    queryClient.setQueryData<AuthSessionResponse | null>(authKeys.session, null);
    queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== authKeys.all[0] });
  }, [queryClient]);

  const permissions = useMemo<ReadonlySet<Permission>>(
    () => (session === null ? EMPTY_PERMISSIONS : new Set(session.permissions)),
    [session],
  );

  const value = useMemo<AuthContextValue>(() => {
    const me = meQuery.data ?? null;
    const memberships = me?.servers ?? NO_MEMBERSHIPS;
    const status: AuthStatus = sessionQuery.isPending ? 'loading' : authenticated ? 'authenticated' : 'anonymous';
    return {
      status,
      session,
      user: session?.user ?? null,
      permissions,
      hasPermission: (permission) => permissions.has(permission),
      hasAnyPermission: (list) => list.some((permission) => permissions.has(permission)),
      hasAllPermissions: (list) => list.every((permission) => permissions.has(permission)),
      mfaEnrollmentRequired: session?.mfa_enrollment_required ?? false,
      mfaEnabled: session?.user.mfa_enabled ?? false,
      csrfToken: session?.csrf_token ?? null,
      me,
      memberships,
      hasServerMembership: memberships.length > 0,
      bootError: sessionQuery.error ?? null,
      refresh,
      setSession,
      logout,
    };
  }, [sessionQuery.isPending, sessionQuery.error, authenticated, session, permissions, meQuery.data, refresh, setSession, logout]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
