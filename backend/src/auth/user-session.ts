/**
 * Web sessions (ARCHITECTURE §12.1).
 *
 * Cookie `stn_session` = 32 random bytes base64url, signed by @fastify/cookie with
 * SESSION_SECRET; HttpOnly, SameSite=Lax, Path=/, Secure per COOKIE_SECURE. The database
 * only stores sha256(token). Sessions expire absolutely (SESSION_TTL_HOURS) and when idle
 * (SESSION_IDLE_TIMEOUT_MINUTES); last_seen_at is refreshed at most once per minute.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { Kysely } from 'kysely';

import { SESSION_COOKIE_NAME, type SessionRevokeReason, type UserRole, type UserStatus } from '@scpsl-trust/shared';

import type { Config } from '../config';
import type { DbExecutor } from '../db/tx';
import type { Database, SessionRow } from '../db/types';
import { hashToken, randomToken } from '../lib/crypto';
import { networkHashes } from '../lib/ip';
import type { Clock } from '../lib/time';
import { csrfTokenFor } from './csrf';
import type { AuthenticatedSession, AuthenticatedUser } from './types';

/** last_seen_at / idle expiry are refreshed at most this often per session. */
export const SESSION_REFRESH_THROTTLE_MS = 60_000;
const SESSION_TOKEN_REGEX = /^[A-Za-z0-9_-]{43}$/;
const USER_AGENT_MAX = 256;

export interface SessionManagerDeps {
  db: Kysely<Database>;
  config: Config;
  clock: Clock;
}

export interface CreateSessionOptions {
  mfa_verified: boolean;
  user_agent?: string | null;
  /** Client IP; only its network hash is stored. */
  ip?: string | null;
}

export interface CreatedSession {
  /** Cookie token (unsigned). Returned once; only its hash is stored. */
  token: string;
  session: SessionRow;
  csrfToken: string;
}

export interface ResolvedSession {
  user: AuthenticatedUser;
  session: AuthenticatedSession;
}

/** Columns of users needed to build request.user. */
interface SessionUserColumns {
  user_id: string;
  email: string;
  username: string;
  role: UserRole;
  status: UserStatus;
  email_verified_at: Date | null;
  totp_enabled_at: Date | null;
  player_id: string | null;
  reviewer_number: number | null;
}

function truncateUserAgent(userAgent: string | null | undefined): string | null {
  if (typeof userAgent !== 'string') return null;
  // Strip control characters; keep at most 256 characters.
  const cleaned = userAgent.replace(/[\x00-\x1f\x7f]/g, '').trim();
  return cleaned === '' ? null : cleaned.slice(0, USER_AGENT_MAX);
}

export class SessionManager {
  private readonly db: Kysely<Database>;
  private readonly config: Config;
  private readonly clock: Clock;

  constructor(deps: SessionManagerDeps) {
    this.db = deps.db;
    this.config = deps.config;
    this.clock = deps.clock;
  }

  private get ttlMs(): number {
    return this.config.session.ttlHours * 3_600_000;
  }

  private get idleMs(): number {
    return this.config.session.idleTimeoutMinutes * 60_000;
  }

  /** CSRF token of a session (§12.1). */
  csrfTokenFor(sessionId: string): string {
    return csrfTokenFor(sessionId, this.config.secrets.sessionSecret);
  }

  /** Whether a user with this role/2FA state must enroll 2FA before using protected routes. */
  requiresMfaEnrollment(role: UserRole, totpEnabled: boolean): boolean {
    return !totpEnabled && this.config.auth.require2faRoles.includes(role);
  }

  /**
   * Creates a new session (call on every login: fixation protection). Run it inside the
   * login transaction so the session and the audit event commit together.
   */
  async createSession(executor: DbExecutor, user: { id: string }, options: CreateSessionOptions): Promise<CreatedSession> {
    const now = this.clock.now();
    const expiresAt = new Date(now.getTime() + this.ttlMs);
    const idleExpiresAt = new Date(Math.min(now.getTime() + this.idleMs, expiresAt.getTime()));
    const token = randomToken(32);
    const ipHash =
      typeof options.ip === 'string' ? (networkHashes(options.ip, this.config.secrets.ipHashSecret)?.network_hash ?? null) : null;
    const session = await executor
      .insertInto('sessions')
      .values({
        user_id: user.id,
        token_hash: hashToken(token),
        mfa_verified: options.mfa_verified,
        created_at: now,
        last_seen_at: now,
        expires_at: expiresAt,
        idle_expires_at: idleExpiresAt,
        user_agent: truncateUserAgent(options.user_agent),
        ip_hash: ipHash,
      })
      .returningAll()
      .executeTakeFirstOrThrow();
    return { token, session, csrfToken: this.csrfTokenFor(session.id) };
  }

  /**
   * Looks up a cookie token. Returns null for unknown, revoked, idle-expired or expired
   * sessions. Refreshes last_seen_at / idle_expires_at (throttled).
   */
  async resolve(token: string): Promise<ResolvedSession | null> {
    if (!SESSION_TOKEN_REGEX.test(token)) return null;
    const now = this.clock.now();
    const row = await this.db
      .selectFrom('sessions as s')
      .innerJoin('users as u', 'u.id', 's.user_id')
      .select([
        's.id',
        's.mfa_verified',
        's.created_at',
        's.last_seen_at',
        's.expires_at',
        's.idle_expires_at',
        's.revoked_at',
        'u.id as user_id',
        'u.email',
        'u.username',
        'u.role',
        'u.status',
        'u.email_verified_at',
        'u.totp_enabled_at',
        'u.player_id',
        'u.reviewer_number',
      ])
      .where('s.token_hash', '=', hashToken(token))
      .executeTakeFirst();
    if (row === undefined || row.revoked_at !== null) return null;
    if (row.expires_at.getTime() <= now.getTime() || row.idle_expires_at.getTime() <= now.getTime()) return null;

    let lastSeenAt = row.last_seen_at;
    let idleExpiresAt = row.idle_expires_at;
    if (now.getTime() - row.last_seen_at.getTime() >= SESSION_REFRESH_THROTTLE_MS) {
      lastSeenAt = now;
      idleExpiresAt = new Date(Math.min(now.getTime() + this.idleMs, row.expires_at.getTime()));
      await this.db
        .updateTable('sessions')
        .set({ last_seen_at: lastSeenAt, idle_expires_at: idleExpiresAt })
        .where('id', '=', row.id)
        .where('revoked_at', 'is', null)
        .execute();
    }

    const user = toAuthenticatedUser(row);
    return {
      user,
      session: {
        id: row.id,
        mfa_verified: row.mfa_verified,
        mfa_enrollment_required: this.requiresMfaEnrollment(user.role, user.totp_enabled),
        created_at: row.created_at,
        last_seen_at: lastSeenAt,
        expires_at: row.expires_at,
        idle_expires_at: idleExpiresAt,
      },
    };
  }

  /** Revokes one session; false when it was already revoked or does not exist. */
  async revokeSession(executor: DbExecutor, sessionId: string, reason: SessionRevokeReason): Promise<boolean> {
    const result = await executor
      .updateTable('sessions')
      .set({ revoked_at: this.clock.now(), revoked_reason: reason })
      .where('id', '=', sessionId)
      .where('revoked_at', 'is', null)
      .executeTakeFirst();
    return Number(result.numUpdatedRows) > 0;
  }

  /** Revokes every active session of a user except `exceptSessionId` (password/2FA changes). */
  async revokeOtherSessions(
    executor: DbExecutor,
    userId: string,
    exceptSessionId: string | null,
    reason: SessionRevokeReason,
  ): Promise<number> {
    let query = executor
      .updateTable('sessions')
      .set({ revoked_at: this.clock.now(), revoked_reason: reason })
      .where('user_id', '=', userId)
      .where('revoked_at', 'is', null);
    if (exceptSessionId !== null) query = query.where('id', '<>', exceptSessionId);
    const result = await query.executeTakeFirst();
    return Number(result.numUpdatedRows);
  }

  /** Revokes all sessions of a user (account disabled, role changed, …). */
  revokeAllSessions(executor: DbExecutor, userId: string, reason: SessionRevokeReason): Promise<number> {
    return this.revokeOtherSessions(executor, userId, null, reason);
  }

  /** Marks a session as 2FA-verified (e.g. right after enabling 2FA on it). */
  async markMfaVerified(executor: DbExecutor, sessionId: string): Promise<void> {
    await executor.updateTable('sessions').set({ mfa_verified: true }).where('id', '=', sessionId).execute();
  }

  // -------------------------------------------------------------------------
  // Cookie handling
  // -------------------------------------------------------------------------

  setSessionCookie(reply: FastifyReply, token: string, expiresAt: Date): void {
    reply.setCookie(SESSION_COOKIE_NAME, token, {
      signed: true,
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.config.cookies.secure,
      expires: expiresAt,
    });
  }

  clearSessionCookie(reply: FastifyReply): void {
    reply.clearCookie(SESSION_COOKIE_NAME, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: this.config.cookies.secure,
    });
  }

  /** Verified (unsigned) cookie token, or null when absent or tampered. */
  readSessionToken(request: FastifyRequest): string | null {
    const raw = request.cookies[SESSION_COOKIE_NAME];
    if (typeof raw !== 'string' || raw.length === 0 || raw.length > 256) return null;
    const unsigned = request.unsignCookie(raw);
    if (!unsigned.valid || unsigned.value === null || !SESSION_TOKEN_REGEX.test(unsigned.value)) return null;
    return unsigned.value;
  }
}

export function toAuthenticatedUser(row: SessionUserColumns): AuthenticatedUser {
  return {
    id: row.user_id,
    email: row.email,
    username: row.username,
    role: row.role,
    status: row.status,
    email_verified: row.email_verified_at !== null,
    totp_enabled: row.totp_enabled_at !== null,
    player_id: row.player_id,
    reviewer_number: row.reviewer_number,
  };
}

/**
 * Populates request.user / request.session from the session cookie. Runs in preValidation,
 * i.e. after route-level rate limiting (onRequest), so floods do not cost a DB lookup each.
 * Invalid or expired cookies are cleared; the request continues anonymously.
 */
export function registerSessionHook(app: FastifyInstance, sessions: SessionManager): void {
  app.addHook('preValidation', async (request, reply) => {
    if (request.cookies[SESSION_COOKIE_NAME] === undefined) return;
    const token = sessions.readSessionToken(request);
    const resolved = token === null ? null : await sessions.resolve(token);
    if (resolved === null) {
      sessions.clearSessionCookie(reply);
      return;
    }
    request.user = resolved.user;
    request.session = resolved.session;
    request.log = request.log.child({ user_id: resolved.user.id });
  });
}
