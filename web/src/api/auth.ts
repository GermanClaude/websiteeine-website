/**
 * /auth/* endpoints (ARCHITECTURE §12.2).
 */
import {
  AuthSessionResponseSchema,
  LoginResponseSchema,
  LoginSuccessResponseSchema,
  OkResponseSchema,
  RecoveryCodesResponseSchema,
  RegisterResponseSchema,
  SessionListResponseSchema,
  TwoFactorSetupResponseSchema,
  type AuthSessionResponse,
  type Login2faRequest,
  type LoginRequest,
  type LoginResponse,
  type LoginSuccessResponse,
  type OkResponse,
  type PasswordChangeRequest,
  type PasswordForgotRequest,
  type PasswordResetRequest,
  type RecoveryCodesRegenerateRequest,
  type RecoveryCodesResponse,
  type RegisterRequest,
  type RegisterResponse,
  type ResendVerificationRequest,
  type SessionListResponse,
  type TwoFactorDisableRequest,
  type TwoFactorEnableRequest,
  type TwoFactorSetupResponse,
  type VerifyEmailRequest,
} from '@scpsl-trust/shared';

import { api, clearCsrfToken, setCsrfToken } from './client';

function rememberCsrf<T extends AuthSessionResponse>(session: T): T {
  setCsrfToken(session.csrf_token);
  return session;
}

export async function getSession(): Promise<AuthSessionResponse> {
  return rememberCsrf(await api.get<AuthSessionResponse>('/auth/session', { schema: AuthSessionResponseSchema }));
}

/** Step 1 of login. `mfa_required: true` means step 2 (`login2fa`) must follow. */
export async function login(body: LoginRequest): Promise<LoginResponse> {
  const response = await api.post<LoginResponse>('/auth/login', body, { schema: LoginResponseSchema });
  if (!response.mfa_required) rememberCsrf(response);
  return response;
}

/** Step 2 of login: TOTP or recovery code. */
export async function login2fa(body: Login2faRequest): Promise<LoginSuccessResponse> {
  // The backend answers with the login-success variant (session + `mfa_required: false`).
  return rememberCsrf(await api.post<LoginSuccessResponse>('/auth/login/2fa', body, { schema: LoginSuccessResponseSchema }));
}

export async function logout(): Promise<void> {
  try {
    await api.post<OkResponse | undefined>('/auth/logout');
  } finally {
    clearCsrfToken();
  }
}

export function register(body: RegisterRequest): Promise<RegisterResponse> {
  return api.post<RegisterResponse>('/auth/register', body, { schema: RegisterResponseSchema });
}

export function verifyEmail(body: VerifyEmailRequest): Promise<OkResponse> {
  return api.post<OkResponse>('/auth/verify-email', body, { schema: OkResponseSchema });
}

export function resendVerification(body: ResendVerificationRequest): Promise<OkResponse | undefined> {
  return api.post<OkResponse | undefined>('/auth/resend-verification', body);
}

/** Always answered 202, whether or not the account exists. */
export function forgotPassword(body: PasswordForgotRequest): Promise<OkResponse | undefined> {
  return api.post<OkResponse | undefined>('/auth/password/forgot', body);
}

export function resetPassword(body: PasswordResetRequest): Promise<OkResponse> {
  return api.post<OkResponse>('/auth/password/reset', body, { schema: OkResponseSchema });
}

export function changePassword(body: PasswordChangeRequest): Promise<OkResponse> {
  return api.post<OkResponse>('/auth/password/change', body, { schema: OkResponseSchema });
}

export function listSessions(): Promise<SessionListResponse> {
  return api.get<SessionListResponse>('/auth/sessions', { schema: SessionListResponseSchema });
}

export function revokeSession(id: string): Promise<OkResponse> {
  return api.post<OkResponse>(`/auth/sessions/${encodeURIComponent(id)}/revoke`, undefined, {
    schema: OkResponseSchema,
  });
}

export function setupTwoFactor(): Promise<TwoFactorSetupResponse> {
  return api.post<TwoFactorSetupResponse>('/auth/2fa/setup', undefined, { schema: TwoFactorSetupResponseSchema });
}

/** Returns the recovery codes — shown exactly once. */
export function enableTwoFactor(body: TwoFactorEnableRequest): Promise<RecoveryCodesResponse> {
  return api.post<RecoveryCodesResponse>('/auth/2fa/enable', body, { schema: RecoveryCodesResponseSchema });
}

export function disableTwoFactor(body: TwoFactorDisableRequest): Promise<OkResponse> {
  return api.post<OkResponse>('/auth/2fa/disable', body, { schema: OkResponseSchema });
}

export function regenerateRecoveryCodes(body: RecoveryCodesRegenerateRequest): Promise<RecoveryCodesResponse> {
  return api.post<RecoveryCodesResponse>('/auth/2fa/recovery-codes', body, { schema: RecoveryCodesResponseSchema });
}
