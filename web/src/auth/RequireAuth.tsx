import type { ReactNode } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { ErrorState } from '../components/ErrorState';
import { LoadingScreen } from '../components/Spinner';
import { MfaEnrollmentGate } from './MfaEnrollmentGate';
import { useAuth } from './useAuth';

export interface LoginRedirectState {
  from?: string;
}

/** Redirects anonymous visitors to /login (remembering where they wanted to go). */
export function RequireAuth({ children }: { children?: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();

  if (auth.status === 'loading') return <LoadingScreen />;
  if (auth.status === 'anonymous') {
    if (auth.bootError !== null && auth.bootError !== undefined) {
      return (
        <div className="app-content">
          <ErrorState error={auth.bootError} title="Could not load your session" onRetry={() => void auth.refresh()} />
        </div>
      );
    }
    const state: LoginRedirectState = { from: `${location.pathname}${location.search}` };
    return <Navigate to="/login" replace state={state} />;
  }
  return <MfaEnrollmentGate>{children ?? <Outlet />}</MfaEnrollmentGate>;
}
