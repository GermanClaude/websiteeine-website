import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router';

import { useAuth } from './useAuth';

export const SECURITY_PATH = '/account/security';

export interface MfaRedirectState {
  mfaEnrollment?: boolean;
}

/**
 * Sessions flagged `mfa_enrollment_required` can only use /auth/* and /me (§12.2):
 * send the user to the security page until 2FA is enabled.
 */
export function MfaEnrollmentGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const location = useLocation();
  if (auth.mfaEnrollmentRequired && !location.pathname.startsWith(SECURITY_PATH)) {
    const state: MfaRedirectState = { mfaEnrollment: true };
    return <Navigate to={SECURITY_PATH} replace state={state} />;
  }
  return <>{children}</>;
}
