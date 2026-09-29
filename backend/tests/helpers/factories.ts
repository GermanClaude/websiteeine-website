/**
 * Data factories for integration tests. They write rows directly (bypassing module
 * services) so every module can set up state without depending on other modules.
 */
import { randomBytes } from 'node:crypto';

import type { FastifyInstance } from 'fastify';
import { sign } from '@fastify/cookie';

import {
  CSRF_HEADER_LOWER,
  SESSION_COOKIE_NAME,
  type PlayerRef,
  type ServerKeyStatus,
  type ServerStatus,
  type UserRole,
  type UserStatus,
} from '@scpsl-trust/shared';

import { encryptTotpSecret, generateTotpSecret } from '../../src/auth/totp';
import type { Deps } from '../../src/container';
import { nextReviewerNumber } from '../../src/db/sequences';
import type { PlayerRow, ServerKeyRow, ServerRow, UserRow } from '../../src/db/types';
import { generateEd25519KeyPair, keyFingerprint, type Ed25519KeyPair } from '../../src/lib/crypto';
import { generateServerId } from '../../src/lib/ids';
import { hashPassword } from '../../src/lib/passwords';

type FactoryDeps = Pick<Deps, 'db' | 'clock' | 'config' | 'sessions' | 'secretBox'>;

let sequence = 0;
function unique(): string {
  sequence += 1;
  return `${Date.now().toString(36)}${sequence.toString(36)}${randomBytes(2).toString('hex')}`;
}

// Argon2 is deliberately slow; cache hashes per password within the test process.
const hashCache = new Map<string, Promise<string>>();
function cachedHash(password: string): Promise<string> {
  let hash = hashCache.get(password);
  if (hash === undefined) {
    hash = hashPassword(password);
    hashCache.set(password, hash);
  }
  return hash;
}

const REVIEWER_ROLES: readonly UserRole[] = ['reviewer', 'moderator', 'admin', 'super_admin'];
export const DEFAULT_TEST_PASSWORD = 'correct-Horse-battery-42';

// ---------------------------------------------------------------------------
// Users & sessions
// ---------------------------------------------------------------------------

export interface CreateUserOptions {
  role?: UserRole;
  email?: string;
  username?: string;
  password?: string;
  /** Email verified (default true). */
  verified?: boolean;
  /** Enable TOTP 2FA (returns the base32 secret). */
  totp?: boolean;
  status?: UserStatus;
  /** Link to an in-game identity (players.id). */
  playerId?: string | null;
  lockedUntil?: Date | null;
}

export interface CreatedUser {
  user: UserRow;
  password: string;
  /** Base32 TOTP secret when `totp: true`. */
  totpSecret: string | null;
}

export async function createUser(deps: FactoryDeps, options: CreateUserOptions = {}): Promise<CreatedUser> {
  const id = unique();
  const role = options.role ?? 'player';
  const password = options.password ?? DEFAULT_TEST_PASSWORD;
  const now = deps.clock.now();
  const user = await deps.db
    .insertInto('users')
    .values({
      email: (options.email ?? `user-${id}@example.test`).toLowerCase(),
      username: options.username ?? `user_${id}`.slice(0, 32),
      password_hash: await cachedHash(password),
      role,
      status: options.status ?? 'active',
      email_verified_at: options.verified === false ? null : now,
      reviewer_number: REVIEWER_ROLES.includes(role) ? await nextReviewerNumber(deps.db) : null,
      player_id: options.playerId ?? null,
      locked_until: options.lockedUntil ?? null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();

  if (options.totp !== true) return { user, password, totpSecret: null };
  const totpSecret = generateTotpSecret();
  const updated = await deps.db
    .updateTable('users')
    .set({ totp_secret_enc: encryptTotpSecret(deps.secretBox, user.id, totpSecret), totp_enabled_at: now })
    .where('id', '=', user.id)
    .returningAll()
    .executeTakeFirstOrThrow();
  return { user: updated, password, totpSecret };
}

export interface TestSession {
  sessionId: string;
  /** Unsigned session token. */
  token: string;
  /** Value for the Cookie header (`stn_session=<signed>`). */
  cookie: string;
  csrfToken: string;
  /** Cookie + CSRF headers for app.inject(). */
  headers: Record<string, string>;
}

/**
 * Creates a session directly (no login request) and returns the signed cookie and CSRF
 * token. `mfa_verified` defaults to whether the user has 2FA enabled.
 */
export async function sessionFor(
  deps: FactoryDeps,
  user: Pick<UserRow, 'id' | 'totp_enabled_at'>,
  options: { mfa_verified?: boolean; user_agent?: string; ip?: string } = {},
): Promise<TestSession> {
  const created = await deps.sessions.createSession(deps.db, user, {
    mfa_verified: options.mfa_verified ?? user.totp_enabled_at !== null,
    user_agent: options.user_agent ?? 'vitest',
    ip: options.ip ?? '198.51.100.23',
  });
  const cookie = `${SESSION_COOKIE_NAME}=${encodeURIComponent(sign(created.token, deps.config.secrets.sessionSecret))}`;
  return {
    sessionId: created.session.id,
    token: created.token,
    cookie,
    csrfToken: created.csrfToken,
    headers: { cookie, [CSRF_HEADER_LOWER]: created.csrfToken },
  };
}

/**
 * Logs a user in for tests. Currently creates the session directly via sessionFor(); the
 * returned shape stays the same if it later goes through POST /auth/login.
 */
export function loginAs(
  app: FastifyInstance,
  user: Pick<UserRow, 'id' | 'totp_enabled_at'>,
  options: { mfa_verified?: boolean } = {},
): Promise<TestSession> {
  return sessionFor(app.deps, user, options);
}

// ---------------------------------------------------------------------------
// Servers & keys
// ---------------------------------------------------------------------------

export interface ServerIdentity {
  server: ServerRow;
  owner: UserRow;
  keyPair: Ed25519KeyPair;
  key: ServerKeyRow | null;
  fingerprint: string;
}

export interface CreateServerOptions {
  owner?: UserRow;
  status?: ServerStatus;
  name?: string;
  isTrusted?: boolean;
  acceptsWhitelistRequests?: boolean;
  /** Status of the initial key (default active). `null` creates no key. */
  keyStatus?: ServerKeyStatus | null;
}

/** Creates a server (default active), its owner membership and an Ed25519 key. */
export async function createServerWithKey(deps: FactoryDeps, options: CreateServerOptions = {}): Promise<ServerIdentity> {
  const owner = options.owner ?? (await createUser(deps, { role: 'server_admin' })).user;
  const status = options.status ?? 'active';
  const now = deps.clock.now();
  const server = await deps.db
    .insertInto('servers')
    .values({
      server_id: generateServerId(),
      name: options.name ?? `Test Server ${unique()}`.slice(0, 64),
      owner_user_id: owner.id,
      status,
      is_trusted: options.isTrusted ?? false,
      accepts_whitelist_requests: options.acceptsWhitelistRequests ?? true,
      registered_at: status === 'pending' ? null : now,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  await deps.db
    .insertInto('server_members')
    .values({ server_id: server.id, user_id: owner.id, role: 'owner', created_by: owner.id, created_at: now })
    .execute();

  const keyPair = generateEd25519KeyPair();
  const fingerprint = keyFingerprint(keyPair.publicKeyB64);
  const keyStatus = options.keyStatus === undefined ? (status === 'pending' ? null : 'active') : options.keyStatus;
  const key = keyStatus === null ? null : await insertServerKey(deps, server, keyPair, { status: keyStatus });
  return { server, owner, keyPair, key, fingerprint };
}

export interface AddKeyOptions {
  status?: ServerKeyStatus;
  /** Grace end for retiring keys (default now + KEY_ROTATION_GRACE_SECONDS). */
  retiringUntil?: Date;
}

async function insertServerKey(
  deps: FactoryDeps,
  server: Pick<ServerRow, 'id'>,
  keyPair: Ed25519KeyPair,
  options: AddKeyOptions,
): Promise<ServerKeyRow> {
  const now = deps.clock.now();
  const status = options.status ?? 'active';
  return deps.db
    .insertInto('server_keys')
    .values({
      server_id: server.id,
      public_key: keyPair.publicKeyB64,
      fingerprint: keyFingerprint(keyPair.publicKeyB64),
      status,
      created_at: now,
      activated_at: now,
      retiring_until:
        status === 'retiring'
          ? (options.retiringUntil ?? new Date(now.getTime() + deps.config.serverAuth.keyRotationGraceSeconds * 1000))
          : null,
      retired_at: status === 'retired' ? now : null,
      revoked_at: status === 'revoked' ? now : null,
      revoke_reason: status === 'revoked' ? 'test revocation' : null,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Adds another key to a server (rotation / revocation scenarios). */
export async function addServerKey(
  deps: FactoryDeps,
  server: Pick<ServerRow, 'id'>,
  options: AddKeyOptions = {},
): Promise<{ keyPair: Ed25519KeyPair; key: ServerKeyRow; fingerprint: string }> {
  const keyPair = generateEd25519KeyPair();
  const key = await insertServerKey(deps, server, keyPair, options);
  return { keyPair, key, fingerprint: key.fingerprint };
}

// ---------------------------------------------------------------------------
// Players
// ---------------------------------------------------------------------------

let steamCounter = 0;

/** A unique valid steam id (17 digits: 7656119 + 4-digit counter + 6 random digits). */
export function randomSteamId(): string {
  steamCounter = (steamCounter + 1) % 10_000;
  const random = (randomBytes(4).readUInt32BE(0) % 1_000_000).toString().padStart(6, '0');
  return `7656119${steamCounter.toString().padStart(4, '0')}${random}`;
}

export async function createPlayer(
  deps: Pick<Deps, 'db' | 'clock'>,
  ref: PlayerRef = { type: 'steam', id: randomSteamId() },
  overrides: { display_name?: string | null; account_created_at?: Date | null } = {},
): Promise<PlayerRow> {
  const now = deps.clock.now();
  return deps.db
    .insertInto('players')
    .values({
      id_type: ref.type,
      external_id: ref.id,
      display_name: overrides.display_name ?? null,
      first_seen_at: now,
      last_seen_at: now,
      account_created_at: overrides.account_created_at ?? null,
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}
