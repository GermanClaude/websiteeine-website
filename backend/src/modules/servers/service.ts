/**
 * Servers business logic: registration (§5.2), heartbeat, key rotation (§5.5),
 * revocation (§5.6) and web server management (§4.2, §13 "Servers").
 */
import {
  AuditAction,
  AuditTargetType,
  buildRegistrationPopMessage,
  buildRotationPopMessage,
  ErrorCode,
  POP_MAX_SKEW_SECONDS,
  type ServerCreateRequest,
  type ServerHeartbeatRequest,
  type ServerHeartbeatResponse,
  type ServerKeyView,
  type ServerMemberView,
  type ServerRegisterRequest,
  type ServerRegisterResponse,
  type ServerSummary,
  type ServerUpdateRequest,
  type ServerView,
  type KeyRotateRequest,
  type KeyRotateResponse,
} from '@scpsl-trust/shared';

import type { AuthenticatedServer, AuthenticatedUser } from '../../auth/types';
import type { Deps } from '../../container';
import { isUniqueViolation, withTransaction, type ServerKeyRow } from '../../db';
import { AppError, conflict, invalidState, notFound } from '../../lib/errors';
import { generateRegistrationToken, generateServerId, generateUuid } from '../../lib/ids';
import { hashToken, keyFingerprint, verifyEd25519 } from '../../lib/crypto';
import { addHours, addSeconds, toIso, toIsoOrNull } from '../../lib/time';
import type { AuditActor } from '../audit';
import { materializeDefaultPolicy } from '../policies';
import * as repo from './repository';
import type { MemberWithUser, ServerSummaryRow, ServerViewRow } from './repository';

export interface RequestContext {
  actor: AuditActor;
  request_id?: string | undefined;
}

// ---------------------------------------------------------------------------
// Mappers (Date → ISO string here; response schemas contain no transforms)
// ---------------------------------------------------------------------------

export function toServerSummary(row: ServerSummaryRow): ServerSummary {
  return {
    server_id: row.server_id,
    name: row.name,
    status: row.status,
    is_trusted: row.is_trusted,
    key_fingerprint: row.key_fingerprint,
    plugin_version: row.plugin_version,
    last_seen_at: toIsoOrNull(row.last_seen_at),
    member_role: row.member_role,
  };
}

export function toServerView(row: ServerViewRow, memberRole: ServerSummary['member_role']): ServerView {
  return {
    server_id: row.server_id,
    name: row.name,
    status: row.status,
    is_trusted: row.is_trusted,
    key_fingerprint: row.key_fingerprint,
    plugin_version: row.plugin_version,
    last_seen_at: toIsoOrNull(row.last_seen_at),
    member_role: memberRole,
    description: row.description,
    owner: { id: row.owner_user_id, username: row.owner_username },
    accepts_whitelist_requests: row.accepts_whitelist_requests,
    game_version: row.game_version,
    registered_at: toIsoOrNull(row.registered_at),
    key_rotation_requested_at: toIsoOrNull(row.key_rotation_requested_at),
    policy_version: row.policy_version,
    created_at: toIso(row.created_at),
    updated_at: toIso(row.updated_at),
  };
}

export function toServerKeyView(row: ServerKeyRow): ServerKeyView {
  return {
    id: row.id,
    fingerprint: row.fingerprint,
    public_key: row.public_key,
    status: row.status,
    created_at: toIso(row.created_at),
    activated_at: toIsoOrNull(row.activated_at),
    retiring_until: toIsoOrNull(row.retiring_until),
    retired_at: toIsoOrNull(row.retired_at),
    revoked_at: toIsoOrNull(row.revoked_at),
    revoke_reason: row.revoke_reason,
  };
}

export function toMemberView(row: MemberWithUser): ServerMemberView {
  return {
    user: { id: row.user_id, username: row.username },
    role: row.role,
    created_at: toIso(row.created_at),
    created_by: row.created_by !== null && row.created_by_username !== null
      ? { id: row.created_by, username: row.created_by_username }
      : null,
  };
}

async function loadServerView(deps: Deps, serverUuid: string, memberRole: ServerSummary['member_role']): Promise<ServerView> {
  const row = await repo.findServerViewRow(deps.db, serverUuid);
  if (row === undefined) throw notFound('Server not found');
  return toServerView(row, memberRole);
}

// ---------------------------------------------------------------------------
// Plugin: registration (§5.2)
// ---------------------------------------------------------------------------

export interface RegistrationResult {
  response: ServerRegisterResponse;
}

export async function registerServer(
  deps: Deps,
  body: ServerRegisterRequest,
  requestId: string | undefined,
): Promise<ServerRegisterResponse> {
  const now = deps.clock.now();

  // 1. Token: hashed lookup; must exist, be unused, unrevoked and unexpired.
  const token = await repo.findTokenByHash(deps.db, hashToken(body.registration_token));
  if (token === undefined || token.used_at !== null || token.revoked_at !== null || token.expires_at.getTime() <= now.getTime()) {
    throw new AppError(ErrorCode.REGISTRATION_TOKEN_INVALID);
  }

  // 2. Timestamp window (±300 s).
  if (Math.abs(now.getTime() - body.timestamp) > POP_MAX_SKEW_SECONDS * 1000) {
    throw new AppError(ErrorCode.INVALID_TIMESTAMP);
  }

  // 3. Proof of possession by the new key.
  const popMessage = buildRegistrationPopMessage(body.registration_token, body.public_key, body.timestamp);
  if (!verifyEd25519(body.public_key, popMessage, body.pop_signature)) {
    throw new AppError(ErrorCode.PROOF_OF_POSSESSION_INVALID);
  }

  const server = await repo.findServerById(deps.db, token.server_id);
  if (server === undefined) throw new AppError(ErrorCode.REGISTRATION_TOKEN_INVALID);
  if (server.status === 'suspended') throw new AppError(ErrorCode.SERVER_SUSPENDED);
  if (server.status === 'revoked') throw new AppError(ErrorCode.SERVER_REVOKED);

  // 4. A server with a usable key is already registered (re-registration only after revocation).
  const activeKey = await repo.findActiveKey(deps.db, server.id);
  if (activeKey !== undefined) throw new AppError(ErrorCode.ALREADY_EXISTS, 'Server is already registered');

  // 5. Fingerprint must be globally unused.
  const fingerprint = keyFingerprint(body.public_key);
  if ((await repo.findKeyByFingerprint(deps.db, fingerprint)) !== undefined) {
    throw new AppError(ErrorCode.ALREADY_EXISTS, 'Public key is already in use');
  }

  const actor: AuditActor = { actor_type: 'server', actor_id: server.server_id };
  try {
    await withTransaction(deps.db, async (trx) => {
      const key = await repo.insertKey(trx, {
        id: generateUuid(),
        server_id: server.id,
        public_key: body.public_key,
        fingerprint,
        status: 'active',
        activated_at: now,
      });
      await repo.updateServer(trx, server.id, {
        status: 'active',
        registered_at: now,
        plugin_version: body.plugin_version,
        game_version: body.game_version ?? server.game_version,
        last_seen_at: now,
      });
      await repo.markTokenUsed(trx, token.id, now);
      await materializeDefaultPolicy(trx, server.id, null);
      await deps.audit.record(trx, {
        actor,
        action: AuditAction.SERVER_REGISTERED,
        target_type: AuditTargetType.SERVER,
        target_id: server.server_id,
        server_id: server.id,
        metadata: { fingerprint, plugin_version: body.plugin_version, key_id: key.id },
        ...(requestId !== undefined ? { request_id: requestId } : {}),
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(ErrorCode.ALREADY_EXISTS, 'Public key is already in use');
    throw error;
  }

  return {
    server_id: server.server_id,
    key_fingerprint: fingerprint,
    status: 'active',
    server_time: toIso(now),
  };
}

// ---------------------------------------------------------------------------
// Plugin: heartbeat
// ---------------------------------------------------------------------------

export async function heartbeat(
  deps: Deps,
  authServer: AuthenticatedServer,
  body: ServerHeartbeatRequest,
): Promise<ServerHeartbeatResponse> {
  const now = deps.clock.now();
  const server = await repo.updateServer(deps.db, authServer.id, {
    last_seen_at: now,
    plugin_version: body.plugin_version,
    ...(body.game_version !== undefined && body.game_version !== null ? { game_version: body.game_version } : {}),
  });
  const policy = await deps.db
    .selectFrom('server_policies')
    .select('version')
    .where('server_id', '=', authServer.id)
    .where('is_active', '=', true)
    .executeTakeFirst();
  return {
    status: server.status,
    policy_version: policy?.version ?? null,
    key_rotation_requested: server.key_rotation_requested_at !== null,
    server_time: toIso(now),
  };
}

// ---------------------------------------------------------------------------
// Plugin: key rotation (§5.5)
// ---------------------------------------------------------------------------

export async function rotateKey(
  deps: Deps,
  authServer: AuthenticatedServer,
  body: KeyRotateRequest,
  requestId: string | undefined,
): Promise<KeyRotateResponse> {
  const now = deps.clock.now();

  // The request must be signed with the CURRENT active key — a retiring key may not rotate again.
  const signingKey = await repo.findKey(deps.db, authServer.key_id);
  if (signingKey === undefined || signingKey.status !== 'active') {
    throw new AppError(ErrorCode.FORBIDDEN, 'Only the active key may rotate');
  }

  if (Math.abs(now.getTime() - body.timestamp) > POP_MAX_SKEW_SECONDS * 1000) {
    throw new AppError(ErrorCode.INVALID_TIMESTAMP);
  }

  const popMessage = buildRotationPopMessage(authServer.server_id, body.new_public_key, body.timestamp);
  if (!verifyEd25519(body.new_public_key, popMessage, body.pop_signature)) {
    throw new AppError(ErrorCode.PROOF_OF_POSSESSION_INVALID);
  }

  const fingerprint = keyFingerprint(body.new_public_key);
  if ((await repo.findKeyByFingerprint(deps.db, fingerprint)) !== undefined) {
    throw new AppError(ErrorCode.ALREADY_EXISTS, 'Public key is already in use');
  }

  const retiringUntil = addSeconds(now, deps.config.serverAuth.keyRotationGraceSeconds);
  try {
    await withTransaction(deps.db, async (trx) => {
      await repo.markKeyRetiring(trx, signingKey.id, retiringUntil);
      await repo.insertKey(trx, {
        id: generateUuid(),
        server_id: authServer.id,
        public_key: body.new_public_key,
        fingerprint,
        status: 'active',
        activated_at: now,
      });
      await repo.updateServer(trx, authServer.id, { key_rotation_requested_at: null });
      await deps.audit.record(trx, {
        actor: { actor_type: 'server', actor_id: authServer.server_id },
        action: AuditAction.SERVER_KEY_ROTATED,
        target_type: AuditTargetType.SERVER_KEY,
        target_id: fingerprint,
        server_id: authServer.id,
        metadata: { new_fingerprint: fingerprint, previous_fingerprint: signingKey.fingerprint },
        ...(requestId !== undefined ? { request_id: requestId } : {}),
      });
    });
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(ErrorCode.ALREADY_EXISTS, 'Public key is already in use');
    throw error;
  }

  return {
    key_fingerprint: fingerprint,
    previous_key_fingerprint: signingKey.fingerprint,
    previous_key_retiring_until: toIso(retiringUntil),
    server_time: toIso(now),
  };
}

// ---------------------------------------------------------------------------
// Web: create / update / tokens
// ---------------------------------------------------------------------------

export interface CreatedServer {
  view: ServerView;
  registrationToken: string;
  registrationTokenExpiresAt: Date;
}

export async function createServer(
  deps: Deps,
  user: AuthenticatedUser,
  body: ServerCreateRequest,
  ctx: RequestContext,
): Promise<CreatedServer> {
  const now = deps.clock.now();
  const token = generateRegistrationToken();
  const expiresAt = addHours(now, deps.config.serverAuth.registrationTokenTtlHours);

  const server = await withTransaction(deps.db, async (trx) => {
    const created = await repo.insertServer(trx, {
      id: generateUuid(),
      server_id: generateServerId(),
      name: body.name,
      description: body.description,
      owner_user_id: user.id,
      status: 'pending',
      accepts_whitelist_requests: body.accepts_whitelist_requests,
    });
    await repo.insertMember(trx, {
      server_id: created.id,
      user_id: user.id,
      role: 'owner',
      created_by: user.id,
    });
    const tokenRow = await repo.insertRegistrationToken(trx, {
      id: generateUuid(),
      server_id: created.id,
      token_hash: hashToken(token),
      created_by: user.id,
      expires_at: expiresAt,
    });
    await deps.audit.record(trx, {
      ...ctx,
      action: AuditAction.SERVER_CREATED,
      target_type: AuditTargetType.SERVER,
      target_id: created.server_id,
      server_id: created.id,
      metadata: { name: created.name },
    });
    await deps.audit.record(trx, {
      ...ctx,
      action: AuditAction.SERVER_REGISTRATION_TOKEN_CREATED,
      target_type: AuditTargetType.SERVER,
      target_id: created.server_id,
      server_id: created.id,
      metadata: { token_id: tokenRow.id, expires_at: toIso(expiresAt) },
    });
    return created;
  });

  const view = await loadServerView(deps, server.id, 'owner');
  return { view, registrationToken: token, registrationTokenExpiresAt: expiresAt };
}

export async function updateServerSettings(
  deps: Deps,
  serverUuid: string,
  memberRole: ServerSummary['member_role'],
  body: ServerUpdateRequest,
  ctx: RequestContext,
): Promise<ServerView> {
  await withTransaction(deps.db, async (trx) => {
    const changes: Record<string, unknown> = {};
    if (body.name !== undefined) changes['name'] = body.name;
    if (body.description !== undefined) changes['description'] = body.description;
    if (body.accepts_whitelist_requests !== undefined) {
      changes['accepts_whitelist_requests'] = body.accepts_whitelist_requests;
    }
    const server = await repo.updateServer(trx, serverUuid, changes);
    await deps.audit.record(trx, {
      ...ctx,
      action: AuditAction.SERVER_UPDATED,
      target_type: AuditTargetType.SERVER,
      target_id: server.server_id,
      server_id: serverUuid,
      metadata: { changed: Object.keys(changes) },
    });
  });
  return loadServerView(deps, serverUuid, memberRole);
}

export async function issueRegistrationToken(
  deps: Deps,
  serverUuid: string,
  serverPublicId: string,
  createdBy: string,
  ctx: RequestContext,
): Promise<{ token: string; expiresAt: Date }> {
  const now = deps.clock.now();
  const token = generateRegistrationToken();
  const expiresAt = addHours(now, deps.config.serverAuth.registrationTokenTtlHours);
  await withTransaction(deps.db, async (trx) => {
    const revoked = await repo.revokeUnusedTokens(trx, serverUuid, now);
    const tokenRow = await repo.insertRegistrationToken(trx, {
      id: generateUuid(),
      server_id: serverUuid,
      token_hash: hashToken(token),
      created_by: createdBy,
      expires_at: expiresAt,
    });
    await deps.audit.record(trx, {
      ...ctx,
      action: AuditAction.SERVER_REGISTRATION_TOKEN_CREATED,
      target_type: AuditTargetType.SERVER,
      target_id: serverPublicId,
      server_id: serverUuid,
      metadata: { token_id: tokenRow.id, revoked_previous: revoked, expires_at: toIso(expiresAt) },
    });
  });
  return { token, expiresAt };
}

// ---------------------------------------------------------------------------
// Web: keys
// ---------------------------------------------------------------------------

export async function revokeServerKey(
  deps: Deps,
  serverUuid: string,
  serverPublicId: string,
  keyId: string,
  reason: string,
  revokedBy: string,
  ctx: RequestContext,
): Promise<void> {
  const key = await repo.findKey(deps.db, keyId);
  if (key === undefined || key.server_id !== serverUuid) throw notFound('Key not found');
  if (key.status === 'revoked') throw invalidState('Key is already revoked');
  await withTransaction(deps.db, async (trx) => {
    await repo.revokeKey(trx, keyId, { now: deps.clock.now(), revokedBy, reason });
    await deps.audit.record(trx, {
      ...ctx,
      action: AuditAction.SERVER_KEY_REVOKED,
      target_type: AuditTargetType.SERVER_KEY,
      target_id: key.fingerprint,
      server_id: serverUuid,
      metadata: { key_id: keyId, reason, previous_status: key.status },
    });
  });
}

export async function requestKeyRotation(
  deps: Deps,
  serverUuid: string,
  serverPublicId: string,
  ctx: RequestContext,
): Promise<Date> {
  const now = deps.clock.now();
  await withTransaction(deps.db, async (trx) => {
    await repo.updateServer(trx, serverUuid, { key_rotation_requested_at: now });
    await deps.audit.record(trx, {
      ...ctx,
      action: AuditAction.SERVER_KEY_ROTATION_REQUESTED,
      target_type: AuditTargetType.SERVER,
      target_id: serverPublicId,
      server_id: serverUuid,
      metadata: {},
    });
  });
  return now;
}

// ---------------------------------------------------------------------------
// Web: members
// ---------------------------------------------------------------------------

export async function addMember(
  deps: Deps,
  serverUuid: string,
  serverPublicId: string,
  body: { username: string; role: 'admin' | 'moderator' },
  creator: { id: string; username: string },
  ctx: RequestContext,
): Promise<ServerMemberView> {
  const user = await repo.findUserByUsername(deps.db, body.username);
  if (user === undefined) throw notFound('User not found');
  const existing = await repo.findMember(deps.db, serverUuid, user.id);
  if (existing !== undefined) throw new AppError(ErrorCode.ALREADY_EXISTS, 'User is already a member');
  try {
    const member = await withTransaction(deps.db, async (trx) => {
      const inserted = await repo.insertMember(trx, {
        server_id: serverUuid,
        user_id: user.id,
        role: body.role,
        created_by: creator.id,
      });
      await deps.audit.record(trx, {
        ...ctx,
        action: AuditAction.SERVER_MEMBER_ADDED,
        target_type: AuditTargetType.SERVER_MEMBER,
        target_id: user.id,
        server_id: serverUuid,
        metadata: { member_role: body.role, username: user.username },
      });
      return inserted;
    });
    return {
      user: { id: user.id, username: user.username },
      role: member.role,
      created_at: toIso(member.created_at),
      created_by: { id: creator.id, username: creator.username },
    };
  } catch (error) {
    if (isUniqueViolation(error)) throw new AppError(ErrorCode.ALREADY_EXISTS, 'User is already a member');
    throw error;
  }
}

export async function removeMember(
  deps: Deps,
  serverUuid: string,
  serverPublicId: string,
  userId: string,
  ctx: RequestContext,
): Promise<void> {
  const member = await repo.findMember(deps.db, serverUuid, userId);
  if (member === undefined) throw notFound('Member not found');
  if (member.role === 'owner') throw invalidState('The owner cannot be removed');
  await withTransaction(deps.db, async (trx) => {
    await repo.deleteMember(trx, serverUuid, userId);
    await deps.audit.record(trx, {
      ...ctx,
      action: AuditAction.SERVER_MEMBER_REMOVED,
      target_type: AuditTargetType.SERVER_MEMBER,
      target_id: userId,
      server_id: serverUuid,
      metadata: { member_role: member.role },
    });
  });
}

// ---------------------------------------------------------------------------
// Web: admin (status / trust)
// ---------------------------------------------------------------------------

export async function changeServerStatus(
  deps: Deps,
  serverPublicId: string,
  body: { status: 'active' | 'suspended' | 'revoked'; reason: string },
  actorUserId: string,
  ctx: RequestContext,
): Promise<ServerView> {
  const server = await repo.findServerByPublicId(deps.db, serverPublicId);
  if (server === undefined) throw notFound('Server not found');
  if (server.status === body.status) throw conflict('Server already has this status');
  const now = deps.clock.now();
  await withTransaction(deps.db, async (trx) => {
    await repo.updateServer(trx, server.id, { status: body.status });
    let revokedKeys = 0;
    if (body.status === 'revoked') {
      revokedKeys = await repo.revokeUsableKeys(trx, server.id, {
        now,
        revokedBy: actorUserId,
        reason: 'Server revoked',
      });
    }
    await deps.audit.record(trx, {
      ...ctx,
      action: AuditAction.SERVER_STATUS_CHANGED,
      target_type: AuditTargetType.SERVER,
      target_id: server.server_id,
      server_id: server.id,
      metadata: { from: server.status, to: body.status, reason: body.reason, revoked_keys: revokedKeys },
    });
  });
  return loadServerView(deps, server.id, null);
}

export async function setServerTrust(
  deps: Deps,
  serverPublicId: string,
  body: { is_trusted: boolean; reason?: string | null },
  ctx: RequestContext,
): Promise<ServerView> {
  const server = await repo.findServerByPublicId(deps.db, serverPublicId);
  if (server === undefined) throw notFound('Server not found');
  await withTransaction(deps.db, async (trx) => {
    await repo.updateServer(trx, server.id, { is_trusted: body.is_trusted });
    await deps.audit.record(trx, {
      ...ctx,
      action: AuditAction.SERVER_TRUST_CHANGED,
      target_type: AuditTargetType.SERVER,
      target_id: server.server_id,
      server_id: server.id,
      metadata: { from: server.is_trusted, to: body.is_trusted, reason: body.reason ?? null },
    });
  });
  return loadServerView(deps, server.id, null);
}
