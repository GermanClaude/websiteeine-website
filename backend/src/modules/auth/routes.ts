/**
 * /api/v1/auth/* (ARCHITECTURE §12.2, §13). Unauthenticated POSTs (register, login, …)
 * work without a session and without CSRF; cookie-authenticated mutations go through the
 * global CSRF hook. All auth endpoints share the per-IP auth rate limit.
 */
import type { FastifyInstance } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';

import {
  AuthSessionResponseSchema,
  Login2faRequestSchema,
  LoginRequestSchema,
  LoginResponseSchema,
  LoginSuccessResponseSchema,
  OkResponseSchema,
  PasswordChangeRequestSchema,
  PasswordForgotRequestSchema,
  PasswordResetRequestSchema,
  RecoveryCodesRegenerateRequestSchema,
  RecoveryCodesResponseSchema,
  RegisterRequestSchema,
  RegisterResponseSchema,
  ResendVerificationRequestSchema,
  SessionListResponseSchema,
  SessionParamsSchema,
  TwoFactorDisableRequestSchema,
  TwoFactorEnableRequestSchema,
  TwoFactorSetupResponseSchema,
  VerifyEmailRequestSchema,
} from '@scpsl-trust/shared';

import { assertAuthenticated, requireAuth } from '../../auth/rbac';
import type { Deps } from '../../container';
import { unauthenticated } from '../../lib/errors';
import { AuthService } from './service';

export async function registerAuthRoutes(app: FastifyInstance, deps: Deps): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const service = new AuthService(deps);
  const authLimit = { rateLimit: deps.rateLimits.auth };

  // -------------------------------------------------------------------------
  // Registration & verification
  // -------------------------------------------------------------------------

  r.post(
    '/auth/register',
    {
      schema: {
        tags: ['auth'],
        summary: 'Create an account',
        body: RegisterRequestSchema,
        response: { 201: RegisterResponseSchema },
      },
      config: authLimit,
    },
    async (request, reply) => {
      const result = await service.register(request, request.body);
      return reply.code(201).send(result);
    },
  );

  r.post(
    '/auth/verify-email',
    {
      schema: { tags: ['auth'], summary: 'Verify an email address', body: VerifyEmailRequestSchema, response: { 200: OkResponseSchema } },
      config: authLimit,
    },
    async (request) => {
      await service.verifyEmail(request, request.body.token);
      return { ok: true as const };
    },
  );

  r.post(
    '/auth/resend-verification',
    {
      schema: {
        tags: ['auth'],
        summary: 'Resend the verification mail (always 202)',
        body: ResendVerificationRequestSchema,
        response: { 202: OkResponseSchema },
      },
      config: authLimit,
    },
    async (request, reply) => {
      await service.resendVerification(request.body.email);
      return reply.code(202).send({ ok: true as const });
    },
  );

  // -------------------------------------------------------------------------
  // Login / logout / session
  // -------------------------------------------------------------------------

  r.post(
    '/auth/login',
    {
      schema: { tags: ['auth'], summary: 'Log in with email and password', body: LoginRequestSchema, response: { 200: LoginResponseSchema } },
      config: authLimit,
    },
    async (request, reply) => service.login(request, reply, request.body),
  );

  r.post(
    '/auth/login/2fa',
    {
      schema: {
        tags: ['auth'],
        summary: 'Complete a login with a TOTP or recovery code',
        body: Login2faRequestSchema,
        response: { 200: LoginSuccessResponseSchema },
      },
      config: authLimit,
    },
    async (request, reply) => service.loginWith2fa(request, reply, request.body),
  );

  r.get(
    '/auth/session',
    {
      schema: { tags: ['auth'], summary: 'Current session', response: { 200: AuthSessionResponseSchema } },
    },
    async (request) => {
      if (request.user === null || request.session === null) throw unauthenticated();
      const user = assertAuthenticated(request);
      return service.sessionResponse(user, request.session);
    },
  );

  r.post(
    '/auth/logout',
    {
      schema: { tags: ['auth'], summary: 'Log out', response: { 200: OkResponseSchema } },
      preHandler: [requireAuth],
    },
    async (request, reply) => {
      await service.logout(request, reply);
      return { ok: true as const };
    },
  );

  r.get(
    '/auth/sessions',
    {
      schema: { tags: ['auth'], summary: 'List own sessions', response: { 200: SessionListResponseSchema } },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return { items: await service.listSessions(user, request.session!.id) };
    },
  );

  r.post(
    '/auth/sessions/:id/revoke',
    {
      schema: { tags: ['auth'], summary: 'Revoke one of your sessions', params: SessionParamsSchema, response: { 200: OkResponseSchema } },
      preHandler: [requireAuth],
    },
    async (request) => {
      const user = assertAuthenticated(request);
      await service.revokeOwnSession(request, user, request.params.id);
      return { ok: true as const };
    },
  );

  // -------------------------------------------------------------------------
  // Passwords
  // -------------------------------------------------------------------------

  r.post(
    '/auth/password/forgot',
    {
      schema: {
        tags: ['auth'],
        summary: 'Request a password reset (always 202)',
        body: PasswordForgotRequestSchema,
        response: { 202: OkResponseSchema },
      },
      config: authLimit,
    },
    async (request, reply) => {
      await service.forgotPassword(request, request.body.email);
      return reply.code(202).send({ ok: true as const });
    },
  );

  r.post(
    '/auth/password/reset',
    {
      schema: { tags: ['auth'], summary: 'Reset the password with a token', body: PasswordResetRequestSchema, response: { 200: OkResponseSchema } },
      config: authLimit,
    },
    async (request) => {
      await service.resetPassword(request, request.body);
      return { ok: true as const };
    },
  );

  r.post(
    '/auth/password/change',
    {
      schema: { tags: ['auth'], summary: 'Change the password', body: PasswordChangeRequestSchema, response: { 200: OkResponseSchema } },
      preHandler: [requireAuth],
      config: authLimit,
    },
    async (request) => {
      const user = assertAuthenticated(request);
      await service.changePassword(request, user, request.session!.id, request.body);
      return { ok: true as const };
    },
  );

  // -------------------------------------------------------------------------
  // Two-factor authentication
  // -------------------------------------------------------------------------

  r.post(
    '/auth/2fa/setup',
    {
      schema: { tags: ['auth'], summary: 'Start TOTP enrollment', response: { 200: TwoFactorSetupResponseSchema } },
      preHandler: [requireAuth],
      config: authLimit,
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return service.setupTotp(user);
    },
  );

  r.post(
    '/auth/2fa/enable',
    {
      schema: {
        tags: ['auth'],
        summary: 'Enable TOTP (returns recovery codes, shown once)',
        body: TwoFactorEnableRequestSchema,
        response: { 200: RecoveryCodesResponseSchema },
      },
      preHandler: [requireAuth],
      config: authLimit,
    },
    async (request) => {
      const user = assertAuthenticated(request);
      const codes = await service.enableTotp(request, user, request.session!.id, request.body.code);
      return { recovery_codes: codes };
    },
  );

  r.post(
    '/auth/2fa/disable',
    {
      schema: { tags: ['auth'], summary: 'Disable TOTP', body: TwoFactorDisableRequestSchema, response: { 200: OkResponseSchema } },
      preHandler: [requireAuth],
      config: authLimit,
    },
    async (request) => {
      const user = assertAuthenticated(request);
      await service.disableTotp(request, user, request.session!.id, request.body);
      return { ok: true as const };
    },
  );

  r.post(
    '/auth/2fa/recovery-codes',
    {
      schema: {
        tags: ['auth'],
        summary: 'Regenerate recovery codes (shown once)',
        body: RecoveryCodesRegenerateRequestSchema,
        response: { 200: RecoveryCodesResponseSchema },
      },
      preHandler: [requireAuth],
      config: authLimit,
    },
    async (request) => {
      const user = assertAuthenticated(request);
      return { recovery_codes: await service.regenerateRecoveryCodes(request, user, request.body) };
    },
  );
}
