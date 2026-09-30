/**
 * Web authentication (ARCHITECTURE §12.1, §12.2): registration, email verification,
 * login with lockout and 2FA, sessions, password reset/change, TOTP enrollment and
 * recovery codes. Controllers stay thin; every state change is one transaction that
 * also writes its audit event.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';

import {
  permissionsForRole,
  type AuthSessionResponse,
  type Permission,
  type SessionListItem,
} from '@scpsl-trust/shared';

import { createTotp, decryptTotpSecret, encryptTotpSecret, generateTotpSecret, totpStep } from '../../auth/totp';
import type { AuthenticatedSession, AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { withTransaction, type DbExecutor } from '../../db/tx';
import { isUniqueViolation } from '../../db/errors';
import type { SessionRow, UserRow } from '../../db/types';
import { hashToken, randomToken } from '../../lib/crypto';
import { AppError, forbidden, notFound } from '../../lib/errors';
import {
  checkPasswordPolicy,
  describePasswordProblems,
  hashPassword,
  needsRehash,
  verifyDummyPassword,
  verifyPassword,
} from '../../lib/passwords';
import { addHours, addMinutes } from '../../lib/time';
import { mailTemplates } from '../../mail/templates';
import { auditContext } from '../audit/actor';
import { storeKeys } from '../../redis/keys';
import * as repo from './repository';

export const EMAIL_VERIFICATION_TTL_HOURS = 24;
export const PASSWORD_RESET_TTL_HOURS = 1;
export const MFA_TOKEN_TTL_MS = 5 * 60_000;
export const TOTP_SETUP_TTL_MS = 10 * 60_000;
export const RECOVERY_CODE_COUNT = 10;
/** §12.2: locked_until = now + 15 min × 2^(n−LOGIN_MAX_FAILURES), capped at 24 h. */
export const LOCKOUT_BASE_MINUTES = 15;
export const LOCKOUT_MAX_MINUTES = 24 * 60;

const RECOVERY_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';
const TOTP_CODE_REGEX = /^\d{6}$/;

/** Pending (not yet enabled) TOTP secrets, encrypted, in the short-lived store. */
export function totpSetupKey(userId: string): string {
  return `mfa:setup:${userId}`;
}

function generateRecoveryCode(): string {
  const groups: string[] = [];
  for (let g = 0; g < 3; g += 1) {
    let group = '';
    for (let i = 0; i < 4; i += 1) {
      group += RECOVERY_CODE_ALPHABET[Math.floor(Math.random() * RECOVERY_CODE_ALPHABET.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}

/** Canonical form of a recovery code before hashing (case-insensitive comparison). */
export function recoveryCodeHash(code: string): string {
  return hashToken(code.trim().toUpperCase());
}

function assertPasswordPolicy(password: string, identity: { email?: string; username?: string }): void {
  const problems = checkPasswordPolicy(password, identity);
  if (problems.length > 0) {
    throw new AppError('PASSWORD_TOO_WEAK', undefined, { problems: describePasswordProblems(problems) });
  }
}

export class AuthService {
  constructor(private readonly deps: Deps) {}

  private get db() {
    return this.deps.db;
  }

  private get config() {
    return this.deps.config;
  }

  private get clock() {
    return this.deps.clock;
  }

  // -------------------------------------------------------------------------
  // Response mapping
  // -------------------------------------------------------------------------

  /** AuthSessionResponse from request.user / request.session (GET /auth/session). */
  sessionResponse(user: AuthenticatedUser, session: AuthenticatedSession): AuthSessionResponse {
    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
        email_verified: user.email_verified,
        mfa_enabled: user.totp_enabled,
      },
      session: {
        id: session.id,
        created_at: session.created_at.toISOString(),
        expires_at: session.expires_at.toISOString(),
        idle_expires_at: session.idle_expires_at.toISOString(),
        mfa_verified: session.mfa_verified,
      },
      permissions: [...permissionsForRole(user.role)] as Permission[],
      csrf_token: this.deps.sessions.csrfTokenFor(session.id),
      mfa_enrollment_required: this.deps.sessions.requiresMfaEnrollment(user.role, user.totp_enabled),
    };
  }

  private loginResponseFor(user: UserRow, session: SessionRow, csrfToken: string): AuthSessionResponse {
    const totpEnabled = user.totp_enabled_at !== null;
    return {
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
        email_verified: user.email_verified_at !== null,
        mfa_enabled: totpEnabled,
      },
      session: {
        id: session.id,
        created_at: session.created_at.toISOString(),
        expires_at: session.expires_at.toISOString(),
        idle_expires_at: session.idle_expires_at.toISOString(),
        mfa_verified: session.mfa_verified,
      },
      permissions: [...permissionsForRole(user.role)] as Permission[],
      csrf_token: csrfToken,
      mfa_enrollment_required: this.deps.sessions.requiresMfaEnrollment(user.role, user.totp_enabled_at !== null),
    };
  }

  // -------------------------------------------------------------------------
  // Registration & email verification
  // -------------------------------------------------------------------------

  async register(
    request: FastifyRequest,
    input: { email: string; username: string; password: string },
  ): Promise<{ user_id: string; email_verification_required: boolean }> {
    if (!this.config.auth.allowRegistration) throw new AppError('REGISTRATION_DISABLED');
    assertPasswordPolicy(input.password, { email: input.email, username: input.username });

    const passwordHash = await hashPassword(input.password);
    const now = this.clock.now();
    const verificationToken = randomToken(32);

    let user: UserRow;
    try {
      user = await withTransaction(this.db, async (trx) => {
        const created = await trx
          .insertInto('users')
          .values({
            email: input.email.toLowerCase(),
            username: input.username,
            password_hash: passwordHash,
            role: 'player',
            status: 'active',
            email_verified_at: this.config.auth.emailVerificationRequired ? null : now,
            created_at: now,
            updated_at: now,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        await repo.insertUserToken(trx, {
          user_id: created.id,
          type: 'email_verification',
          token_hash: hashToken(verificationToken),
          expires_at: addHours(now, EMAIL_VERIFICATION_TTL_HOURS),
          created_at: now,
        });
        await this.deps.audit.record(trx, {
          actor: { actor_type: 'user', actor_id: created.id },
          request_id: request.id,
          action: 'USER_REGISTERED',
          target_type: 'user',
          target_id: created.id,
          metadata: { role: created.role },
        });
        return created;
      });
    } catch (err) {
      if (isUniqueViolation(err, 'users_email_key')) {
        throw new AppError('ALREADY_EXISTS', 'An account with this email already exists', { field: 'email' });
      }
      if (isUniqueViolation(err, 'users_username_key')) {
        throw new AppError('ALREADY_EXISTS', 'This username is already taken', { field: 'username' });
      }
      throw err;
    }

    await this.sendVerificationMail(user, verificationToken);
    return { user_id: user.id, email_verification_required: this.config.auth.emailVerificationRequired };
  }

  private async sendVerificationMail(user: Pick<UserRow, 'email' | 'username'>, token: string): Promise<void> {
    await this.deps.mailer.send(
      mailTemplates.emailVerification({
        to: user.email,
        username: user.username,
        actionUrl: `${this.config.http.webOrigin}/verify-email?token=${token}`,
        expiresInText: `${EMAIL_VERIFICATION_TTL_HOURS} hours`,
      }),
    );
  }

  async verifyEmail(request: FastifyRequest, token: string): Promise<void> {
    const now = this.clock.now();
    await withTransaction(this.db, async (trx) => {
      const consumed = await repo.consumeUserToken(trx, 'email_verification', hashToken(token), now);
      if (consumed === undefined) throw new AppError('TOKEN_INVALID');
      const user = await repo.findUserById(trx, consumed.user_id);
      if (user === undefined) throw new AppError('TOKEN_INVALID');
      if (user.email_verified_at === null) {
        await trx.updateTable('users').set({ email_verified_at: now, updated_at: now }).where('id', '=', user.id).execute();
      }
      await this.deps.audit.record(trx, {
        actor: { actor_type: 'user', actor_id: user.id },
        request_id: request.id,
        action: 'USER_EMAIL_VERIFIED',
        target_type: 'user',
        target_id: user.id,
      });
    });
  }

  /** Always succeeds (202): never reveals whether the address exists. */
  async resendVerification(email: string): Promise<void> {
    const user = await repo.findUserByEmail(this.db, email);
    if (user === undefined || user.email_verified_at !== null || user.status !== 'active') return;
    const now = this.clock.now();
    const token = randomToken(32);
    await withTransaction(this.db, async (trx) => {
      await repo.invalidateUserTokens(trx, user.id, 'email_verification', now);
      await repo.insertUserToken(trx, {
        user_id: user.id,
        type: 'email_verification',
        token_hash: hashToken(token),
        expires_at: addHours(now, EMAIL_VERIFICATION_TTL_HOURS),
        created_at: now,
      });
    });
    await this.sendVerificationMail(user, token);
  }

  // -------------------------------------------------------------------------
  // Login & lockout
  // -------------------------------------------------------------------------

  async login(
    request: FastifyRequest,
    reply: FastifyReply,
    input: { email: string; password: string },
  ): Promise<{ mfa_required: true; mfa_token: string } | ({ mfa_required: false } & AuthSessionResponse)> {
    const now = this.clock.now();
    const user = await repo.findUserByEmail(this.db, input.email);
    if (user === undefined) {
      // Equal timing with the wrong-password path (§12.2).
      await verifyDummyPassword(input.password);
      await this.deps.audit.record(this.db, {
        actor: { actor_type: 'user', actor_id: null },
        request_id: request.id,
        action: 'USER_LOGIN_FAILED',
        target_type: 'user',
        target_id: null,
        metadata: { reason: 'unknown_account' },
      });
      throw new AppError('INVALID_CREDENTIALS');
    }

    this.assertNotLocked(user, now);

    const passwordOk = await verifyPassword(user.password_hash, input.password);
    if (!passwordOk) {
      await this.registerLoginFailure(request, user, now);
      throw new AppError('INVALID_CREDENTIALS');
    }

    if (user.status !== 'active') throw new AppError('ACCOUNT_DISABLED');
    if (user.email_verified_at === null && this.config.auth.emailVerificationRequired) {
      throw new AppError('EMAIL_NOT_VERIFIED');
    }

    if (needsRehash(user.password_hash)) {
      const rehashed = await hashPassword(input.password);
      await this.db.updateTable('users').set({ password_hash: rehashed, updated_at: now }).where('id', '=', user.id).execute();
    }

    if (user.totp_enabled_at !== null) {
      const mfaToken = randomToken(32);
      await this.deps.store.set(storeKeys.mfaToken(hashToken(mfaToken)), user.id, MFA_TOKEN_TTL_MS);
      return { mfa_required: true, mfa_token: mfaToken };
    }

    const response = await this.completeLogin(request, reply, user, { mfaVerified: false });
    return { mfa_required: false as const, ...response };
  }

  private assertNotLocked(user: UserRow, now: Date): void {
    if (user.locked_until !== null && user.locked_until.getTime() > now.getTime()) {
      const retryAfter = Math.ceil((user.locked_until.getTime() - now.getTime()) / 1000);
      throw new AppError('ACCOUNT_LOCKED', undefined, { retry_after: retryAfter });
    }
  }

  private async registerLoginFailure(request: FastifyRequest, user: UserRow, now: Date): Promise<void> {
    await withTransaction(this.db, async (trx) => {
      const updated = await repo.incrementFailedLogins(trx, user.id);
      const failures = updated?.failed_login_count ?? user.failed_login_count + 1;
      await this.deps.audit.record(trx, {
        actor: { actor_type: 'user', actor_id: null },
        request_id: request.id,
        action: 'USER_LOGIN_FAILED',
        target_type: 'user',
        target_id: user.id,
        metadata: { reason: 'wrong_password', failures },
      });
      const max = this.config.auth.loginMaxFailures;
      if (failures < max) return;
      const minutes = Math.min(LOCKOUT_BASE_MINUTES * 2 ** (failures - max), LOCKOUT_MAX_MINUTES);
      const lockedUntil = addMinutes(now, minutes);
      await trx.updateTable('users').set({ locked_until: lockedUntil, updated_at: now }).where('id', '=', user.id).execute();
      await this.deps.audit.record(trx, {
        actor: { actor_type: 'user', actor_id: null },
        request_id: request.id,
        action: 'USER_LOCKED',
        target_type: 'user',
        target_id: user.id,
        metadata: { failures, locked_minutes: minutes },
      });
    });
  }

  /** Creates the session, resets lockout, sets the cookie and audits the login. */
  private async completeLogin(
    request: FastifyRequest,
    reply: FastifyReply,
    user: UserRow,
    options: { mfaVerified: boolean; usedRecoveryCode?: boolean; totpStepUsed?: number },
  ): Promise<AuthSessionResponse> {
    const now = this.clock.now();
    const { response, token, expiresAt } = await withTransaction(this.db, async (trx) => {
      await trx
        .updateTable('users')
        .set({
          failed_login_count: 0,
          locked_until: null,
          last_login_at: now,
          updated_at: now,
          ...(options.totpStepUsed !== undefined ? { totp_last_used_step: options.totpStepUsed } : {}),
        })
        .where('id', '=', user.id)
        .execute();
      const created = await this.deps.sessions.createSession(trx, user, {
        mfa_verified: options.mfaVerified,
        user_agent: request.headers['user-agent'] ?? null,
        ip: request.ip,
      });
      await this.deps.audit.record(trx, {
        actor: { actor_type: 'user', actor_id: user.id },
        request_id: request.id,
        action: 'USER_LOGIN_SUCCEEDED',
        target_type: 'user',
        target_id: user.id,
        metadata: { mfa: options.mfaVerified, recovery_code: options.usedRecoveryCode === true },
      });
      return { response: this.loginResponseFor(user, created.session, created.csrfToken), token: created.token, expiresAt: created.session.expires_at };
    });
    this.deps.sessions.setSessionCookie(reply, token, expiresAt);
    return response;
  }

  // -------------------------------------------------------------------------
  // 2FA login
  // -------------------------------------------------------------------------

  async loginWith2fa(
    request: FastifyRequest,
    reply: FastifyReply,
    input: { mfa_token: string; code: string },
  ): Promise<{ mfa_required: false } & AuthSessionResponse> {
    const key = storeKeys.mfaToken(hashToken(input.mfa_token));
    const userId = await this.deps.store.get(key);
    if (userId === null) throw new AppError('MFA_TOKEN_INVALID');
    const user = await repo.findUserById(this.db, userId);
    if (user === undefined || user.status !== 'active' || user.totp_enabled_at === null || user.totp_secret_enc === null) {
      await this.deps.store.del(key);
      throw new AppError('MFA_TOKEN_INVALID');
    }
    this.assertNotLocked(user, this.clock.now());

    const verified = await this.verifyMfaCode(this.db, user, input.code, { consumeRecoveryCode: false });
    if (verified === null) throw new AppError('INVALID_MFA_CODE');

    // Single use: the token is consumed exactly once, on success.
    const consumed = await this.deps.store.delIfEquals(key, userId);
    if (!consumed) throw new AppError('MFA_TOKEN_INVALID');

    const now = this.clock.now();
    if (verified.kind === 'recovery') {
      await withTransaction(this.db, async (trx) => {
        const used = await repo.consumeRecoveryCode(trx, user.id, verified.codeHash, now);
        if (!used) throw new AppError('INVALID_MFA_CODE');
        await this.deps.audit.record(trx, {
          actor: { actor_type: 'user', actor_id: user.id },
          request_id: request.id,
          action: 'USER_RECOVERY_CODE_USED',
          target_type: 'user',
          target_id: user.id,
        });
      });
    }

    const response = await this.completeLogin(request, reply, user, {
      mfaVerified: true,
      usedRecoveryCode: verified.kind === 'recovery',
      ...(verified.kind === 'totp' ? { totpStepUsed: verified.step } : {}),
    });
    return { mfa_required: false as const, ...response };
  }

  /**
   * Verifies a TOTP code (±1 step, replay-protected via totp_last_used_step) or a
   * recovery code. Returns null when invalid. Recovery codes are only *checked* here;
   * consumption (single use + audit) is the caller's transaction unless
   * `consumeRecoveryCode` is set.
   */
  private async verifyMfaCode(
    db: DbExecutor,
    user: UserRow,
    code: string,
    options: { consumeRecoveryCode: boolean; requestId?: string },
  ): Promise<{ kind: 'totp'; step: number } | { kind: 'recovery'; codeHash: string } | null> {
    if (TOTP_CODE_REGEX.test(code.trim())) {
      if (user.totp_secret_enc === null) return null;
      const secret = decryptTotpSecret(this.deps.secretBox, user.id, user.totp_secret_enc);
      const now = this.clock.now();
      const delta = createTotp(secret).validate({ token: code.trim(), timestamp: now.getTime(), window: 1 });
      if (delta === null) return null;
      const step = totpStep(now) + delta;
      if (user.totp_last_used_step !== null && step <= user.totp_last_used_step) return null;
      return { kind: 'totp', step };
    }
    const codeHash = recoveryCodeHash(code);
    if (options.consumeRecoveryCode) {
      const consumed = await repo.consumeRecoveryCode(db, user.id, codeHash, this.clock.now());
      if (!consumed) return null;
      await this.deps.audit.record(db, {
        actor: { actor_type: 'user', actor_id: user.id },
        request_id: options.requestId ?? null,
        action: 'USER_RECOVERY_CODE_USED',
        target_type: 'user',
        target_id: user.id,
      });
      return { kind: 'recovery', codeHash };
    }
    const exists = await repo.hasUnusedRecoveryCode(db, user.id, codeHash);
    return exists ? { kind: 'recovery', codeHash } : null;
  }

  // -------------------------------------------------------------------------
  // Logout & sessions
  // -------------------------------------------------------------------------

  async logout(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const user = request.user;
    const session = request.session;
    if (user === null || session === null) return;
    await withTransaction(this.db, async (trx) => {
      const revoked = await this.deps.sessions.revokeSession(trx, session.id, 'logout');
      if (revoked) {
        await this.deps.audit.record(trx, {
          ...auditContext(request),
          action: 'USER_LOGOUT',
          target_type: 'session',
          target_id: session.id,
        });
      }
    });
    this.deps.sessions.clearSessionCookie(reply);
  }

  async listSessions(user: AuthenticatedUser, currentSessionId: string): Promise<SessionListItem[]> {
    const rows = await repo.listActiveSessions(this.db, user.id, this.clock.now());
    return rows.map((row) => ({
      id: row.id,
      created_at: row.created_at.toISOString(),
      last_seen_at: row.last_seen_at.toISOString(),
      expires_at: row.expires_at.toISOString(),
      idle_expires_at: row.idle_expires_at.toISOString(),
      mfa_verified: row.mfa_verified,
      user_agent: row.user_agent,
      current: row.id === currentSessionId,
    }));
  }

  /** Revokes one of the caller's own sessions. Other users' sessions read as 404. */
  async revokeOwnSession(request: FastifyRequest, user: AuthenticatedUser, sessionId: string): Promise<void> {
    const session = await repo.findOwnSession(this.db, user.id, sessionId);
    if (session === undefined) throw notFound('Session not found');
    await withTransaction(this.db, async (trx) => {
      const revoked = await this.deps.sessions.revokeSession(trx, sessionId, 'user_revoked');
      if (revoked) {
        await this.deps.audit.record(trx, {
          ...auditContext(request),
          action: 'SESSION_REVOKED',
          target_type: 'session',
          target_id: sessionId,
          metadata: { reason: 'user_revoked' },
        });
      }
    });
  }

  // -------------------------------------------------------------------------
  // Password reset & change
  // -------------------------------------------------------------------------

  /** Always succeeds (202): never reveals whether the address exists. */
  async forgotPassword(request: FastifyRequest, email: string): Promise<void> {
    const user = await repo.findUserByEmail(this.db, email);
    if (user === undefined || user.status !== 'active') return;
    const now = this.clock.now();
    const token = randomToken(32);
    await withTransaction(this.db, async (trx) => {
      await repo.invalidateUserTokens(trx, user.id, 'password_reset', now);
      await repo.insertUserToken(trx, {
        user_id: user.id,
        type: 'password_reset',
        token_hash: hashToken(token),
        expires_at: addHours(now, PASSWORD_RESET_TTL_HOURS),
        created_at: now,
      });
      await this.deps.audit.record(trx, {
        actor: { actor_type: 'user', actor_id: user.id },
        request_id: request.id,
        action: 'USER_PASSWORD_RESET_REQUESTED',
        target_type: 'user',
        target_id: user.id,
      });
    });
    await this.deps.mailer.send(
      mailTemplates.passwordReset({
        to: user.email,
        username: user.username,
        actionUrl: `${this.config.http.webOrigin}/reset-password?token=${token}`,
        expiresInText: '1 hour',
      }),
    );
  }

  async resetPassword(request: FastifyRequest, input: { token: string; password: string }): Promise<void> {
    const now = this.clock.now();
    await withTransaction(this.db, async (trx) => {
      const consumed = await repo.consumeUserToken(trx, 'password_reset', hashToken(input.token), now);
      if (consumed === undefined) throw new AppError('TOKEN_INVALID');
      const user = await repo.findUserById(trx, consumed.user_id);
      if (user === undefined) throw new AppError('TOKEN_INVALID');
      assertPasswordPolicy(input.password, { email: user.email, username: user.username });
      const passwordHash = await hashPassword(input.password);
      await trx
        .updateTable('users')
        .set({ password_hash: passwordHash, failed_login_count: 0, locked_until: null, updated_at: now })
        .where('id', '=', user.id)
        .execute();
      await this.deps.sessions.revokeAllSessions(trx, user.id, 'password_reset');
      await this.deps.audit.record(trx, {
        actor: { actor_type: 'user', actor_id: user.id },
        request_id: request.id,
        action: 'USER_PASSWORD_RESET',
        target_type: 'user',
        target_id: user.id,
      });
    });
  }

  async changePassword(
    request: FastifyRequest,
    user: AuthenticatedUser,
    sessionId: string,
    input: { current_password: string; new_password: string },
  ): Promise<void> {
    const row = await repo.findUserById(this.db, user.id);
    if (row === undefined) throw new AppError('UNAUTHENTICATED');
    const ok = await verifyPassword(row.password_hash, input.current_password);
    if (!ok) throw new AppError('PASSWORD_INCORRECT');
    assertPasswordPolicy(input.new_password, { email: row.email, username: row.username });
    const passwordHash = await hashPassword(input.new_password);
    const now = this.clock.now();
    await withTransaction(this.db, async (trx) => {
      await trx.updateTable('users').set({ password_hash: passwordHash, updated_at: now }).where('id', '=', user.id).execute();
      await this.deps.sessions.revokeOtherSessions(trx, user.id, sessionId, 'password_changed');
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'USER_PASSWORD_CHANGED',
        target_type: 'user',
        target_id: user.id,
      });
    });
  }

  // -------------------------------------------------------------------------
  // TOTP enrollment
  // -------------------------------------------------------------------------

  async setupTotp(user: AuthenticatedUser): Promise<{ secret: string; otpauth_uri: string }> {
    if (user.totp_enabled) throw new AppError('MFA_ALREADY_ENABLED');
    const secret = generateTotpSecret();
    // Stored encrypted (the store may be Redis); bound to the user via AAD.
    await this.deps.store.set(totpSetupKey(user.id), encryptTotpSecret(this.deps.secretBox, user.id, secret), TOTP_SETUP_TTL_MS);
    return { secret, otpauth_uri: createTotp(secret, user.email).toString() };
  }

  async enableTotp(request: FastifyRequest, user: AuthenticatedUser, sessionId: string, code: string): Promise<string[]> {
    if (user.totp_enabled) throw new AppError('MFA_ALREADY_ENABLED');
    const pendingEnc = await this.deps.store.get(totpSetupKey(user.id));
    if (pendingEnc === null) throw new AppError('MFA_SETUP_NOT_STARTED');
    const secret = decryptTotpSecret(this.deps.secretBox, user.id, pendingEnc);
    const now = this.clock.now();
    const delta = createTotp(secret).validate({ token: code.trim(), timestamp: now.getTime(), window: 1 });
    if (delta === null) throw new AppError('INVALID_MFA_CODE');

    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    await withTransaction(this.db, async (trx) => {
      await trx
        .updateTable('users')
        .set({
          totp_secret_enc: encryptTotpSecret(this.deps.secretBox, user.id, secret),
          totp_enabled_at: now,
          totp_last_used_step: totpStep(now) + delta,
          updated_at: now,
        })
        .where('id', '=', user.id)
        .execute();
      await repo.replaceRecoveryCodes(trx, user.id, codes.map(recoveryCodeHash), now);
      await this.deps.sessions.revokeOtherSessions(trx, user.id, sessionId, 'mfa_changed');
      await this.deps.sessions.markMfaVerified(trx, sessionId);
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'USER_2FA_ENABLED',
        target_type: 'user',
        target_id: user.id,
      });
    });
    await this.deps.store.del(totpSetupKey(user.id));
    return codes;
  }

  async disableTotp(
    request: FastifyRequest,
    user: AuthenticatedUser,
    sessionId: string,
    input: { password: string; code: string },
  ): Promise<void> {
    if (this.config.auth.require2faRoles.includes(user.role)) {
      throw forbidden('Two-factor authentication is required for your role and cannot be disabled');
    }
    const row = await this.requireTotpUser(user.id);
    await this.assertPasswordAndMfa(request, row, input);
    const now = this.clock.now();
    await withTransaction(this.db, async (trx) => {
      await trx
        .updateTable('users')
        .set({ totp_secret_enc: null, totp_enabled_at: null, totp_last_used_step: null, updated_at: now })
        .where('id', '=', user.id)
        .execute();
      await repo.deleteRecoveryCodes(trx, user.id);
      await this.deps.sessions.revokeOtherSessions(trx, user.id, sessionId, 'mfa_changed');
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'USER_2FA_DISABLED',
        target_type: 'user',
        target_id: user.id,
      });
    });
  }

  async regenerateRecoveryCodes(
    request: FastifyRequest,
    user: AuthenticatedUser,
    input: { password: string; code: string },
  ): Promise<string[]> {
    const row = await this.requireTotpUser(user.id);
    await this.assertPasswordAndMfa(request, row, input);
    const codes = Array.from({ length: RECOVERY_CODE_COUNT }, generateRecoveryCode);
    const now = this.clock.now();
    await withTransaction(this.db, async (trx) => {
      await repo.replaceRecoveryCodes(trx, user.id, codes.map(recoveryCodeHash), now);
      await this.deps.audit.record(trx, {
        ...auditContext(request),
        action: 'USER_2FA_ENABLED',
        target_type: 'user',
        target_id: user.id,
        metadata: { recovery_codes_regenerated: true },
      });
    });
    return codes;
  }

  private async requireTotpUser(userId: string): Promise<UserRow> {
    const row = await repo.findUserById(this.db, userId);
    if (row === undefined) throw new AppError('UNAUTHENTICATED');
    if (row.totp_enabled_at === null || row.totp_secret_enc === null) throw new AppError('MFA_NOT_ENABLED');
    return row;
  }

  /** Password + (TOTP or recovery code) confirmation for sensitive 2FA operations. */
  private async assertPasswordAndMfa(
    request: FastifyRequest,
    row: UserRow,
    input: { password: string; code: string },
  ): Promise<void> {
    const ok = await verifyPassword(row.password_hash, input.password);
    if (!ok) throw new AppError('PASSWORD_INCORRECT');
    const verified = await this.verifyMfaCode(this.db, row, input.code, {
      consumeRecoveryCode: true,
      requestId: request.id,
    });
    if (verified === null) throw new AppError('INVALID_MFA_CODE');
    if (verified.kind === 'totp') {
      await this.db
        .updateTable('users')
        .set({ totp_last_used_step: verified.step, updated_at: this.clock.now() })
        .where('id', '=', row.id)
        .execute();
    }
  }
}
