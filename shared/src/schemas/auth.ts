/**
 * Web authentication schemas (ARCHITECTURE §12.1, §12.2): /auth/*.
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { UserRoleSchema, UserStatusSchema } from '../enums';
import { USER_TOKEN_REGEX } from '../formats';
import { PermissionSchema } from '../permissions';
import { EmailInputSchema, EmailSchema, IsoDateTimeSchema, listOf, UsernameSchema, UuidSchema } from './common';

/** New passwords: 10–128 characters. */
export const PasswordSchema = z.string().min(LIMITS.PASSWORD_MIN).max(LIMITS.PASSWORD_MAX);
/** Existing passwords (login / confirmation) are only length-bounded. */
export const CurrentPasswordSchema = z.string().min(1).max(LIMITS.PASSWORD_MAX);
export const UserTokenSchema = z.string().regex(USER_TOKEN_REGEX, 'Invalid token');
export const TotpCodeSchema = z.string().trim().regex(/^\d{6}$/, 'Code must be 6 digits');
/** TOTP code or recovery code. */
export const MfaCodeSchema = z
  .string()
  .trim()
  .regex(/^(?:\d{6}|[A-Za-z0-9-]{8,32})$/, 'Invalid authentication or recovery code');
export const MfaTokenSchema = z.string().min(16).max(128).regex(/^[A-Za-z0-9_-]+$/, 'Invalid token');

function passwordDiffersFromIdentity(password: string, identities: readonly string[]): boolean {
  const lowered = password.toLowerCase();
  return identities.every((identity) => identity.length === 0 || identity.toLowerCase() !== lowered);
}

// ---------------------------------------------------------------------------
// Registration / verification / password reset
// ---------------------------------------------------------------------------

export const RegisterRequestSchema = z
  .object({
    email: EmailInputSchema,
    username: UsernameSchema,
    password: PasswordSchema,
  })
  .refine((body) => passwordDiffersFromIdentity(body.password, [body.email, body.username]), {
    message: 'Password must not equal the email or username',
    path: ['password'],
  });
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>;

export const RegisterResponseSchema = z.object({
  user_id: UuidSchema,
  email_verification_required: z.boolean(),
});
export type RegisterResponse = z.infer<typeof RegisterResponseSchema>;

export const VerifyEmailRequestSchema = z.object({ token: UserTokenSchema });
export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const ResendVerificationRequestSchema = z.object({ email: EmailInputSchema });
export type ResendVerificationRequest = z.infer<typeof ResendVerificationRequestSchema>;

/** POST /auth/password/forgot — always answered with 202 OkResponse. */
export const PasswordForgotRequestSchema = z.object({ email: EmailInputSchema });
export type PasswordForgotRequest = z.infer<typeof PasswordForgotRequestSchema>;

export const PasswordResetRequestSchema = z.object({
  token: UserTokenSchema,
  password: PasswordSchema,
});
export type PasswordResetRequest = z.infer<typeof PasswordResetRequestSchema>;

export const PasswordChangeRequestSchema = z
  .object({
    current_password: CurrentPasswordSchema,
    new_password: PasswordSchema,
  })
  .refine((body) => body.current_password !== body.new_password, {
    message: 'New password must differ from the current password',
    path: ['new_password'],
  });
export type PasswordChangeRequest = z.infer<typeof PasswordChangeRequestSchema>;

// ---------------------------------------------------------------------------
// Login & session
// ---------------------------------------------------------------------------

export const LoginRequestSchema = z.object({
  email: EmailInputSchema,
  password: CurrentPasswordSchema,
});
export type LoginRequest = z.infer<typeof LoginRequestSchema>;

export const SessionUserSchema = z.object({
  id: UuidSchema,
  email: EmailSchema,
  username: z.string(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  email_verified: z.boolean(),
  mfa_enabled: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const SessionInfoSchema = z.object({
  id: UuidSchema,
  created_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema,
  idle_expires_at: IsoDateTimeSchema,
  mfa_verified: z.boolean(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;

/** Authenticated session state (login success, 2FA success, GET /auth/session). */
export const AuthSessionResponseSchema = z.object({
  user: SessionUserSchema,
  session: SessionInfoSchema,
  permissions: z.array(PermissionSchema),
  csrf_token: z.string().min(1),
  /** Role requires 2FA but none is enrolled: only /auth/* and /me are usable (§12.2). */
  mfa_enrollment_required: z.boolean(),
});
export type AuthSessionResponse = z.infer<typeof AuthSessionResponseSchema>;

export const LoginSuccessResponseSchema = AuthSessionResponseSchema.extend({ mfa_required: z.literal(false) });
export type LoginSuccessResponse = z.infer<typeof LoginSuccessResponseSchema>;
export const LoginMfaRequiredResponseSchema = z.object({
  mfa_required: z.literal(true),
  mfa_token: z.string(),
});
export const LoginResponseSchema = z.discriminatedUnion('mfa_required', [
  LoginSuccessResponseSchema,
  LoginMfaRequiredResponseSchema,
]);
export type LoginResponse = z.infer<typeof LoginResponseSchema>;

export const Login2faRequestSchema = z.object({
  mfa_token: MfaTokenSchema,
  code: MfaCodeSchema,
});
export type Login2faRequest = z.infer<typeof Login2faRequestSchema>;

export const SessionListItemSchema = z.object({
  id: UuidSchema,
  created_at: IsoDateTimeSchema,
  last_seen_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema,
  idle_expires_at: IsoDateTimeSchema,
  mfa_verified: z.boolean(),
  user_agent: z.string().max(LIMITS.USER_AGENT_MAX).nullable(),
  current: z.boolean(),
});
export type SessionListItem = z.infer<typeof SessionListItemSchema>;

export const SessionListResponseSchema = listOf(SessionListItemSchema);
export type SessionListResponse = z.infer<typeof SessionListResponseSchema>;

export const SessionParamsSchema = z.object({ id: UuidSchema });
export type SessionParams = z.infer<typeof SessionParamsSchema>;

// ---------------------------------------------------------------------------
// Two-factor authentication
// ---------------------------------------------------------------------------

export const TwoFactorSetupResponseSchema = z.object({
  secret: z.string().regex(/^[A-Z2-7]+=*$/, 'Base32 secret'),
  otpauth_uri: z.string().startsWith('otpauth://totp/'),
});
export type TwoFactorSetupResponse = z.infer<typeof TwoFactorSetupResponseSchema>;

export const TwoFactorEnableRequestSchema = z.object({ code: TotpCodeSchema });
export type TwoFactorEnableRequest = z.infer<typeof TwoFactorEnableRequestSchema>;

/** Recovery codes are shown exactly once. */
export const RecoveryCodesResponseSchema = z.object({
  recovery_codes: z.array(z.string()).min(1).max(20),
});
export type RecoveryCodesResponse = z.infer<typeof RecoveryCodesResponseSchema>;

/** Password + current code (2FA disable, recovery-code regeneration). */
export const TwoFactorConfirmRequestSchema = z.object({
  password: CurrentPasswordSchema,
  code: MfaCodeSchema,
});
export type TwoFactorConfirmRequest = z.infer<typeof TwoFactorConfirmRequestSchema>;

export const TwoFactorDisableRequestSchema = TwoFactorConfirmRequestSchema;
export type TwoFactorDisableRequest = TwoFactorConfirmRequest;
export const RecoveryCodesRegenerateRequestSchema = TwoFactorConfirmRequestSchema;
export type RecoveryCodesRegenerateRequest = TwoFactorConfirmRequest;
