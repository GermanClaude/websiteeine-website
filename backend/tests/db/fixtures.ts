/**
 * Minimal valid rows for every table. Each factory accepts overrides so tests
 * can violate exactly one rule at a time.
 */
import { createHash, randomUUID } from 'node:crypto';

import type { DbExecutor } from '../../src/db/tx';
import type {
  AppealRow,
  AuditEventRow,
  BypassRow,
  CaseRow,
  CaseServerConfirmationRow,
  EvidenceReviewRow,
  EvidenceRow,
  NewAppeal,
  NewAuditEvent,
  NewBypass,
  NewCase,
  NewCaseServerConfirmation,
  NewEvidence,
  NewEvidenceReview,
  NewOverwatchSession,
  NewPlayer,
  NewReport,
  NewReview,
  NewServer,
  NewServerKey,
  NewServerPolicy,
  NewServerPolicyRule,
  NewUser,
  NewWhitelistRequest,
  OverwatchSessionRow,
  PlayerRow,
  ReportRow,
  ReviewRow,
  ServerKeyRow,
  ServerPolicyRow,
  ServerPolicyRuleRow,
  ServerRow,
  UserRow,
  WhitelistRequestRow,
} from '../../src/db/types';

let counter = 0;
function next(): number {
  counter += 1;
  return counter;
}

const CROCKFORD = '0123456789abcdefghjkmnpqrstvwxyz';

export const ARGON2_HASH = '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$ZmFrZWhhc2hmYWtlaGFzaGZha2VoYXNo';
export const GENESIS_HASH = '0'.repeat(64);

export function hex64(seed: string | number): string {
  return createHash('sha256').update(String(seed)).digest('hex');
}

/** srv_ + 16 Crockford base32 chars derived from n. */
export function serverPublicId(n: number): string {
  let value = n;
  let out = '';
  for (let i = 0; i < 16; i += 1) {
    out = (CROCKFORD[value % 32] ?? '0') + out;
    value = Math.floor(value / 32);
  }
  return `srv_${out}`;
}

/** Deterministic, valid base64 of 32 bytes. */
export function publicKeyFor(n: number): string {
  return createHash('sha256').update(`key-${n}`).digest('base64');
}

export function steamId(n: number): string {
  return (76_561_198_000_000_000n + BigInt(n)).toString();
}

export async function insertUser(db: DbExecutor, overrides: Partial<NewUser> = {}): Promise<UserRow> {
  const n = next();
  return db
    .insertInto('users')
    .values({ email: `user${n}@example.test`, username: `user_${n}`, password_hash: ARGON2_HASH, ...overrides })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertPlayer(db: DbExecutor, overrides: Partial<NewPlayer> = {}): Promise<PlayerRow> {
  const n = next();
  return db
    .insertInto('players')
    .values({ id_type: 'steam', external_id: steamId(n), display_name: `Player${n}`, ...overrides })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertServer(
  db: DbExecutor,
  ownerUserId: string,
  overrides: Partial<NewServer> = {},
): Promise<ServerRow> {
  const n = next();
  return db
    .insertInto('servers')
    .values({ server_id: serverPublicId(n), name: `Server ${n}`, owner_user_id: ownerUserId, ...overrides })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertServerKey(
  db: DbExecutor,
  serverId: string,
  overrides: Partial<NewServerKey> = {},
): Promise<ServerKeyRow> {
  const n = next();
  return db
    .insertInto('server_keys')
    .values({ server_id: serverId, public_key: publicKeyFor(n), fingerprint: `SHA256:${hex64(`fp-${n}`)}`, ...overrides })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertPolicy(
  db: DbExecutor,
  serverId: string,
  overrides: Partial<NewServerPolicy> = {},
): Promise<ServerPolicyRow> {
  const n = next();
  return db
    .insertInto('server_policies')
    .values({ server_id: serverId, version: n, is_active: false, ...overrides })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertRule(
  db: DbExecutor,
  policyId: string,
  overrides: Partial<NewServerPolicyRule> = {},
): Promise<ServerPolicyRuleRow> {
  const n = next();
  return db
    .insertInto('server_policy_rules')
    .values({
      policy_id: policyId,
      sort_order: n,
      signal: 'global_verdict',
      action: 'admin_notify',
      statuses: ['confirmed'],
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertCase(db: DbExecutor, playerId: string, overrides: Partial<NewCase> = {}): Promise<CaseRow> {
  const n = next();
  return db
    .insertInto('cases')
    .values({
      case_number: `CASE-2026-${String(n).padStart(6, '0')}`,
      player_id: playerId,
      reason: 'Suspected aimbot',
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertReport(
  db: DbExecutor,
  refs: { caseId: string; playerId: string; reporterUserId: string },
  overrides: Partial<NewReport> = {},
): Promise<ReportRow> {
  return db
    .insertInto('reports')
    .values({
      case_id: refs.caseId,
      player_id: refs.playerId,
      reporter_type: 'user',
      reporter_user_id: refs.reporterUserId,
      reason: 'Aimbot',
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertAppeal(
  db: DbExecutor,
  refs: { caseId: string; playerId: string; userId: string },
  overrides: Partial<NewAppeal> = {},
): Promise<AppealRow> {
  return db
    .insertInto('appeals')
    .values({
      case_id: refs.caseId,
      player_id: refs.playerId,
      submitted_by_user_id: refs.userId,
      statement: 'I was not cheating; please review the footage again.',
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertReview(
  db: DbExecutor,
  refs: { caseId: string; reviewerUserId: string },
  overrides: Partial<NewReview> = {},
): Promise<ReviewRow> {
  return db
    .insertInto('reviews')
    .values({ case_id: refs.caseId, reviewer_user_id: refs.reviewerUserId, kind: 'note', comment: 'Looked at it', ...overrides })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertConfirmation(
  db: DbExecutor,
  refs: { caseId: string; serverId: string; userId: string },
  overrides: Partial<NewCaseServerConfirmation> = {},
): Promise<CaseServerConfirmationRow> {
  return db
    .insertInto('case_server_confirmations')
    .values({ case_id: refs.caseId, server_id: refs.serverId, confirmed_by_user_id: refs.userId, ...overrides })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertEvidence(
  db: DbExecutor,
  refs: { caseId: string; uploaderUserId: string },
  overrides: Partial<NewEvidence> = {},
): Promise<EvidenceRow> {
  const n = next();
  return db
    .insertInto('evidence')
    .values({
      case_id: refs.caseId,
      type: 'video',
      title: `Clip ${n}`,
      sha256: hex64(`evidence-${n}`),
      size_bytes: 1024,
      mime_type: 'video/mp4',
      original_filename: `clip-${n}.mp4`,
      storage_key: `evidence/${n}.mp4`,
      uploader_user_id: refs.uploaderUserId,
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertLinkEvidence(
  db: DbExecutor,
  refs: { caseId: string; uploaderUserId: string },
  overrides: Partial<NewEvidence> = {},
): Promise<EvidenceRow> {
  const n = next();
  return db
    .insertInto('evidence')
    .values({
      case_id: refs.caseId,
      type: 'link',
      title: `Link ${n}`,
      external_url: `https://videos.example.test/${n}`,
      uploader_user_id: refs.uploaderUserId,
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertEvidenceReview(
  db: DbExecutor,
  refs: { evidenceId: string; reviewerUserId: string },
  overrides: Partial<NewEvidenceReview> = {},
): Promise<EvidenceReviewRow> {
  return db
    .insertInto('evidence_reviews')
    .values({
      evidence_id: refs.evidenceId,
      reviewer_user_id: refs.reviewerUserId,
      status: 'verified',
      identity_status: 'verified',
      authenticity_status: 'verified',
      cheating_status: 'verified',
      comment: 'Clear aimbot snapping',
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertOverwatchSession(
  db: DbExecutor,
  refs: { serverId: string; targetPlayerId: string; spectatorPlayerId: string },
  overrides: Partial<NewOverwatchSession> = {},
): Promise<OverwatchSessionRow> {
  const now = new Date();
  return db
    .insertInto('overwatch_sessions')
    .values({
      server_id: refs.serverId,
      target_player_id: refs.targetPlayerId,
      spectator_player_id: refs.spectatorPlayerId,
      secret_enc: 'v1:aXY=:Y2lwaGVy:dGFn',
      started_at: now,
      last_heartbeat_at: now,
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertWhitelistRequest(
  db: DbExecutor,
  refs: { playerId: string; userId: string; serverId: string },
  overrides: Partial<NewWhitelistRequest> = {},
): Promise<WhitelistRequestRow> {
  return db
    .insertInto('whitelist_requests')
    .values({
      player_id: refs.playerId,
      requester_user_id: refs.userId,
      server_id: refs.serverId,
      type: 'vpn_whitelist',
      reason: 'My ISP uses carrier-grade NAT',
      expires_at: new Date(Date.now() + 14 * 86_400_000),
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export async function insertBypass(
  db: DbExecutor,
  refs: { playerId: string; grantedByUserId: string; serverId: string | null },
  overrides: Partial<NewBypass> = {},
): Promise<BypassRow> {
  return db
    .insertInto('bypasses')
    .values({
      player_id: refs.playerId,
      scope: refs.serverId === null ? 'global' : 'server',
      server_id: refs.serverId,
      type: 'vpn_whitelist',
      reason: 'Known player',
      granted_by_user_id: refs.grantedByUserId,
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

/** Appends a (structurally valid) audit event after the current chain head. */
export async function insertAuditEvent(db: DbExecutor, overrides: Partial<NewAuditEvent> = {}): Promise<AuditEventRow> {
  const head = await db
    .selectFrom('audit_events')
    .select(['seq', 'hash'])
    .orderBy('seq', 'desc')
    .limit(1)
    .executeTakeFirst();
  const seq = (head?.seq ?? 0) + 1;
  return db
    .insertInto('audit_events')
    .values({
      seq,
      event_id: randomUUID(),
      created_at: new Date(),
      actor_type: 'system',
      action: 'RETENTION_RUN',
      target_type: 'system',
      prev_hash: head?.hash ?? GENESIS_HASH,
      hash: hex64(`audit-${seq}-${randomUUID()}`),
      ...overrides,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface World {
  user: UserRow;
  reviewer: UserRow;
  player: PlayerRow;
  otherPlayer: PlayerRow;
  server: ServerRow;
  serverKey: ServerKeyRow;
  policy: ServerPolicyRow;
  rule: ServerPolicyRuleRow;
  caseRow: CaseRow;
  report: ReportRow;
  appeal: AppealRow;
  review: ReviewRow;
  confirmation: CaseServerConfirmationRow;
  overwatch: OverwatchSessionRow;
  evidence: EvidenceRow;
  evidenceReview: EvidenceReviewRow;
  whitelistRequest: WhitelistRequestRow;
  bypass: BypassRow;
  auditEvent: AuditEventRow;
}

/** One row in every table, linked consistently. */
export async function createWorld(db: DbExecutor): Promise<World> {
  const user = await insertUser(db);
  const reviewer = await insertUser(db, { role: 'reviewer', reviewer_number: next() });
  const player = await insertPlayer(db);
  const otherPlayer = await insertPlayer(db);
  const server = await insertServer(db, user.id, { status: 'active' });
  await db.insertInto('server_members').values({ server_id: server.id, user_id: user.id, role: 'owner', created_by: user.id }).execute();
  await db
    .insertInto('server_registration_tokens')
    .values({ server_id: server.id, token_hash: hex64(`reg-${server.id}`), created_by: user.id, expires_at: new Date(Date.now() + 86_400_000) })
    .execute();
  const serverKey = await insertServerKey(db, server.id);
  const policy = await insertPolicy(db, server.id, { is_active: true });
  const rule = await insertRule(db, policy.id);
  const caseRow = await insertCase(db, player.id, { created_by_user_id: user.id });
  const report = await insertReport(db, { caseId: caseRow.id, playerId: player.id, reporterUserId: user.id });
  const appeal = await insertAppeal(db, { caseId: caseRow.id, playerId: player.id, userId: user.id });
  const review = await insertReview(db, { caseId: caseRow.id, reviewerUserId: reviewer.id });
  const confirmation = await insertConfirmation(db, { caseId: caseRow.id, serverId: server.id, userId: user.id });
  const overwatch = await insertOverwatchSession(db, {
    serverId: server.id,
    targetPlayerId: player.id,
    spectatorPlayerId: otherPlayer.id,
  });
  const evidence = await insertEvidence(
    db,
    { caseId: caseRow.id, uploaderUserId: user.id },
    { report_id: report.id, overwatch_session_id: overwatch.id },
  );
  const evidenceReview = await insertEvidenceReview(db, { evidenceId: evidence.id, reviewerUserId: reviewer.id });
  const whitelistRequest = await insertWhitelistRequest(db, { playerId: player.id, userId: user.id, serverId: server.id });
  const bypass = await insertBypass(db, { playerId: player.id, grantedByUserId: user.id, serverId: server.id });
  await db
    .insertInto('player_network_observations')
    .values({ player_id: player.id, network_hash: hex64('net-1'), prefix_hash: hex64('pfx-1'), server_id: server.id })
    .execute();
  await db.insertInto('player_server_sightings').values({ player_id: player.id, server_id: server.id }).execute();
  await db
    .insertInto('player_signals')
    .values({ player_id: player.id, server_id: server.id, signal: 'vpn_detected', confidence: 'likely', source: 'cidr-list', detail_codes: ['hosting'] })
    .execute();
  await db
    .insertInto('player_links')
    .values({ player_id: player.id, linked_player_id: otherPlayer.id, signal: 'same_network_identifier' })
    .execute();
  await db.insertInto('user_recovery_codes').values({ user_id: user.id, code_hash: hex64(`rc-${user.id}`) }).execute();
  await db
    .insertInto('user_tokens')
    .values({ user_id: user.id, type: 'email_verification', token_hash: hex64(`tok-${user.id}`), expires_at: new Date(Date.now() + 86_400_000) })
    .execute();
  await db
    .insertInto('sessions')
    .values({
      user_id: user.id,
      token_hash: hex64(`sess-${user.id}`),
      mfa_verified: false,
      expires_at: new Date(Date.now() + 86_400_000),
      idle_expires_at: new Date(Date.now() + 3_600_000),
    })
    .execute();
  await db.insertInto('case_counters').values({ year: 2026, last_value: 1 }).onConflict((oc) => oc.doNothing()).execute();
  await db.insertInto('job_runs').values({ job: 'retention' }).execute();
  const auditEvent = await insertAuditEvent(db, { case_id: caseRow.id, server_id: server.id });

  return {
    user,
    reviewer,
    player,
    otherPlayer,
    server,
    serverKey,
    policy,
    rule,
    caseRow,
    report,
    appeal,
    review,
    confirmation,
    overwatch,
    evidence,
    evidenceReview,
    whitelistRequest,
    bypass,
    auditEvent,
  };
}
