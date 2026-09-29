import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { FORBIDDEN_OPERATION_SQLSTATE, isForbiddenOperation } from '../../src/db/errors';
import { useTestDatabase } from '../helpers/test-db';
import { catchPgError } from './assertions';
import {
  createWorld,
  hex64,
  insertCase,
  insertConfirmation,
  insertEvidence,
  insertLinkEvidence,
  insertPolicy,
  insertUser,
} from './fixtures';
import type { World } from './fixtures';

const DELETE_PROTECTED = [
  'cases',
  'reports',
  'reviews',
  'evidence',
  'evidence_reviews',
  'case_server_confirmations',
  'appeals',
  'whitelist_requests',
  'bypasses',
  'audit_events',
  'server_policies',
  'server_policy_rules',
] as const;

const UPDATE_PROTECTED = ['reviews', 'evidence_reviews', 'audit_events', 'server_policy_rules'] as const;

describe('history protection triggers (R7/R8)', () => {
  const getDb = useTestDatabase();
  let world: World;

  beforeAll(async () => {
    world = await createWorld(getDb().db);
  });

  async function rowCount(table: string): Promise<number> {
    const result = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(table)}`.execute(getDb().db);
    return result.rows[0]?.n ?? 0;
  }

  describe.each(DELETE_PROTECTED)('%s', (table) => {
    it('rejects DELETE with the forbidden-operation SQLSTATE', async () => {
      const before = await rowCount(table);
      expect(before).toBeGreaterThan(0);
      const error = await catchPgError(sql`DELETE FROM ${sql.table(table)}`.execute(getDb().db));
      expect(error.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
      expect(error.table).toBe(table);
      expect(error.message).toContain('DELETE');
      expect(await rowCount(table)).toBe(before);
    });

    it('rejects TRUNCATE, also with CASCADE', async () => {
      const before = await rowCount(table);
      // Plain TRUNCATE of a table referenced by foreign keys already fails with 0A000.
      const plain = await catchPgError(sql`TRUNCATE ${sql.table(table)}`.execute(getDb().db));
      expect([FORBIDDEN_OPERATION_SQLSTATE, '0A000']).toContain(plain.code);
      const cascade = await catchPgError(sql`TRUNCATE ${sql.table(table)} CASCADE`.execute(getDb().db));
      expect(cascade.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
      expect(await rowCount(table)).toBe(before);
    });
  });

  it('blocks TRUNCATE of a parent table that would cascade into protected tables', async () => {
    const error = await catchPgError(sql`TRUNCATE players CASCADE`.execute(getDb().db));
    expect(error.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
    expect(await rowCount('players')).toBeGreaterThan(0);
  });

  describe.each(UPDATE_PROTECTED)('%s', (table) => {
    it('rejects UPDATE of any column', async () => {
      const column = table === 'audit_events' ? 'target_id' : table === 'server_policy_rules' ? 'message' : 'comment';
      const error = await catchPgError(
        sql`UPDATE ${sql.table(table)} SET ${sql.ref(column)} = 'tampered'`.execute(getDb().db),
      );
      expect(error.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
      expect(error.table).toBe(table);
    });
  });

  it('isForbiddenOperation() recognizes trigger errors raised through Kysely', async () => {
    const { db } = getDb();
    let caught: unknown;
    try {
      await db.deleteFrom('audit_events').execute();
    } catch (err) {
      caught = err;
    }
    expect(isForbiddenOperation(caught)).toBe(true);
    expect(isForbiddenOperation(caught, 'audit_events')).toBe(true);
    expect(isForbiddenOperation(caught, 'cases')).toBe(false);
  });

  it('keeps the audit chain untouched even for a "no-op" UPDATE', async () => {
    const error = await catchPgError(sql`UPDATE audit_events SET hash = hash`.execute(getDb().db));
    expect(error.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
  });

  it('still allows the workflow state changes of mutable history tables', async () => {
    const { db } = getDb();
    await db.updateTable('cases').set({ status: 'under_review' }).where('id', '=', world.caseRow.id).execute();
    await db.updateTable('reports').set({ status: 'under_review' }).where('id', '=', world.report.id).execute();
    await db.updateTable('appeals').set({ assigned_reviewer_id: world.reviewer.id }).where('id', '=', world.appeal.id).execute();
    await db
      .updateTable('whitelist_requests')
      .set({ decision_note: 'looking into it' })
      .where('id', '=', world.whitelistRequest.id)
      .execute();
    await db.updateTable('bypasses').set({ expired_processed_at: new Date() }).where('id', '=', world.bypass.id).execute();
    const row = await db.selectFrom('cases').select('status').where('id', '=', world.caseRow.id).executeTakeFirstOrThrow();
    expect(row.status).toBe('under_review');
  });

  it('allows retention deletes on non-history tables', async () => {
    const { db } = getDb();
    await db.deleteFrom('player_signals').where('player_id', '=', world.player.id).execute();
    await db.deleteFrom('player_network_observations').where('player_id', '=', world.player.id).execute();
    await db.deleteFrom('sessions').where('user_id', '=', world.user.id).execute();
    await db.deleteFrom('user_tokens').where('user_id', '=', world.user.id).execute();
    expect(await rowCount('player_signals')).toBe(0);
  });

  it('set_updated_at() bumps updated_at on UPDATE', async () => {
    const { db } = getDb();
    const past = new Date('2020-01-01T00:00:00.000Z');
    const user = await insertUser(db, { created_at: past, updated_at: past });
    expect(user.updated_at.toISOString()).toBe(past.toISOString());
    const updated = await db
      .updateTable('users')
      .set({ failed_login_count: 1 })
      .where('id', '=', user.id)
      .returning('updated_at')
      .executeTakeFirstOrThrow();
    expect(updated.updated_at.getTime()).toBeGreaterThan(past.getTime());
  });
});

describe('evidence immutability', () => {
  const getDb = useTestDatabase();
  let world: World;

  beforeAll(async () => {
    world = await createWorld(getDb().db);
  });

  const immutableUpdates: [string, () => Record<string, unknown>][] = [
    ['sha256', () => ({ sha256: hex64('tampered') })],
    ['size_bytes', () => ({ size_bytes: 1 })],
    ['mime_type', () => ({ mime_type: 'image/png' })],
    ['storage_key', () => ({ storage_key: 'evidence/other.mp4' })],
    ['original_filename', () => ({ original_filename: 'renamed.mp4' })],
    ['uploaded_at', () => ({ uploaded_at: new Date('2020-01-01T00:00:00Z') })],
    ['uploader_user_id', () => ({ uploader_user_id: world.reviewer.id })],
    ['uploader_server_id', () => ({ uploader_server_id: world.server.id })],
    ['type', () => ({ type: 'image' })],
    ['title', () => ({ title: 'Renamed' })],
    ['description', () => ({ description: 'rewritten' })],
    ['report_id', () => ({ report_id: null })],
    ['overwatch_session_id', () => ({ overwatch_session_id: null })],
    ['created_at', () => ({ created_at: new Date('2020-01-01T00:00:00Z') })],
    ['id', () => ({ id: '00000000-0000-4000-8000-000000000000' })],
  ];

  it.each(immutableUpdates)('rejects changing %s', async (column, patch) => {
    const values = patch();
    const assignments = Object.entries(values).map(([key, value]) => sql`${sql.ref(key)} = ${value}`);
    const error = await catchPgError(
      sql`UPDATE evidence SET ${sql.join(assignments)} WHERE id = ${world.evidence.id}`.execute(getDb().db),
    );
    expect(error.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
    expect(error.column).toBe(column);
  });

  it('rejects changing case_id to another case', async () => {
    const { db } = getDb();
    const otherCase = await insertCase(db, world.player.id);
    const error = await catchPgError(sql`UPDATE evidence SET case_id = ${otherCase.id} WHERE id = ${world.evidence.id}`.execute(db));
    expect(error.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
  });

  it('rejects changing external_url of link evidence', async () => {
    const { db } = getDb();
    const link = await insertLinkEvidence(db, { caseId: world.caseRow.id, uploaderUserId: world.user.id });
    const error = await catchPgError(
      sql`UPDATE evidence SET external_url = 'https://evil.example.test/x' WHERE id = ${link.id}`.execute(db),
    );
    expect(error.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
    expect(error.column).toBe('external_url');
  });

  it('allows changing the review status columns', async () => {
    const { db } = getDb();
    const updated = await db
      .updateTable('evidence')
      .set({ status: 'verified', identity_status: 'verified', authenticity_status: 'inconclusive', cheating_status: 'rejected' })
      .where('id', '=', world.evidence.id)
      .returningAll()
      .executeTakeFirstOrThrow();
    expect(updated).toMatchObject({
      status: 'verified',
      identity_status: 'verified',
      authenticity_status: 'inconclusive',
      cheating_status: 'rejected',
      sha256: world.evidence.sha256,
    });
  });

  it('allows superseded_by_evidence_id to be set exactly once, to the superseding row', async () => {
    const { db } = getDb();
    const original = await insertEvidence(db, { caseId: world.caseRow.id, uploaderUserId: world.user.id });
    const unrelated = await insertEvidence(db, { caseId: world.caseRow.id, uploaderUserId: world.user.id });

    // Only the row that declares supersedes_evidence_id = original.id may be linked.
    const wrongTarget = await catchPgError(
      db.updateTable('evidence').set({ superseded_by_evidence_id: unrelated.id }).where('id', '=', original.id).execute(),
    );
    expect(wrongTarget.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);

    const replacement = await insertEvidence(
      db,
      { caseId: world.caseRow.id, uploaderUserId: world.user.id },
      { supersedes_evidence_id: original.id },
    );
    await db.updateTable('evidence').set({ superseded_by_evidence_id: replacement.id }).where('id', '=', original.id).execute();

    const second = await insertEvidence(db, { caseId: world.caseRow.id, uploaderUserId: world.user.id });
    const resetAttempt = await catchPgError(
      db.updateTable('evidence').set({ superseded_by_evidence_id: second.id }).where('id', '=', original.id).execute(),
    );
    expect(resetAttempt.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
    expect(resetAttempt.message).toContain('only be set once');

    const clearAttempt = await catchPgError(
      sql`UPDATE evidence SET superseded_by_evidence_id = NULL WHERE id = ${original.id}`.execute(db),
    );
    expect(clearAttempt.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);

    // Superseded evidence can still be reviewed.
    await db.updateTable('evidence').set({ status: 'rejected' }).where('id', '=', original.id).execute();
  });

  it('rejects a second successor and superseding across cases or already superseded evidence', async () => {
    const { db } = getDb();
    const original = await insertEvidence(db, { caseId: world.caseRow.id, uploaderUserId: world.user.id });
    const refs = { caseId: world.caseRow.id, uploaderUserId: world.user.id };
    const replacement = await insertEvidence(db, refs, { supersedes_evidence_id: original.id });

    const secondSuccessor = await catchPgError(insertEvidence(db, refs, { supersedes_evidence_id: original.id }));
    expect(secondSuccessor).toMatchObject({ code: '23505', constraint: 'evidence_supersedes_evidence_id_key' });

    const otherCase = await insertCase(db, world.player.id);
    const crossCase = await catchPgError(
      insertEvidence(db, { caseId: otherCase.id, uploaderUserId: world.user.id }, { supersedes_evidence_id: replacement.id }),
    );
    expect(crossCase.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);

    await db.updateTable('evidence').set({ superseded_by_evidence_id: replacement.id }).where('id', '=', original.id).execute();
    const alreadySuperseded = await catchPgError(
      sql`INSERT INTO evidence (case_id, type, title, sha256, size_bytes, mime_type, storage_key, uploader_user_id, supersedes_evidence_id)
          VALUES (${world.caseRow.id}, 'video', 'x', ${hex64('x2')}, 1, 'video/mp4', 'evidence/x2', ${world.user.id}, ${original.id})`.execute(db),
    );
    // The BEFORE INSERT guard fires before the unique index is checked.
    expect(alreadySuperseded.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
  });

  it('rejects superseded_by_evidence_id on INSERT', async () => {
    const { db } = getDb();
    const error = await catchPgError(
      sql`INSERT INTO evidence (case_id, type, title, sha256, size_bytes, mime_type, storage_key, uploader_user_id, superseded_by_evidence_id)
          VALUES (${world.caseRow.id}, 'video', 'x', ${hex64('x3')}, 1, 'video/mp4', 'evidence/x3', ${world.user.id}, ${world.evidence.id})`.execute(db),
    );
    expect(error.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
  });
});

describe('policy version and confirmation guards', () => {
  const getDb = useTestDatabase();
  let world: World;

  beforeAll(async () => {
    world = await createWorld(getDb().db);
  });

  it('server_policies: only is_active may change', async () => {
    const { db } = getDb();
    const policy = await insertPolicy(db, world.server.id, { is_active: false, whitelist_url: 'https://trust.example.test/wl' });
    await db.updateTable('server_policies').set({ is_active: false }).where('id', '=', world.policy.id).execute();
    await db.updateTable('server_policies').set({ is_active: true }).where('id', '=', policy.id).execute();

    for (const statement of [
      sql`UPDATE server_policies SET version = 999 WHERE id = ${policy.id}`,
      sql`UPDATE server_policies SET whitelist_url = 'https://evil.example.test' WHERE id = ${policy.id}`,
      sql`UPDATE server_policies SET backend_unavailable_action = 'kick' WHERE id = ${policy.id}`,
      sql`UPDATE server_policies SET honor_global_bypasses = true WHERE id = ${policy.id}`,
    ]) {
      const error = await catchPgError(statement.execute(db));
      expect(error.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
    }
  });

  it('case_server_confirmations: can be revoked once, then frozen', async () => {
    const { db } = getDb();
    const caseRow = await insertCase(db, world.player.id);
    const confirmation = await insertConfirmation(db, { caseId: caseRow.id, serverId: world.server.id, userId: world.user.id });

    const noteChange = await catchPgError(
      sql`UPDATE case_server_confirmations SET note = 'rewritten' WHERE id = ${confirmation.id}`.execute(db),
    );
    expect(noteChange).toMatchObject({ code: FORBIDDEN_OPERATION_SQLSTATE, column: 'note' });

    await db
      .updateTable('case_server_confirmations')
      .set({ revoked_at: new Date(), revoked_by: world.user.id, revoke_reason: 'mistake' })
      .where('id', '=', confirmation.id)
      .execute();

    const reinstate = await catchPgError(
      sql`UPDATE case_server_confirmations SET revoked_at = NULL WHERE id = ${confirmation.id}`.execute(db),
    );
    expect(reinstate.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);
    const rewriteReason = await catchPgError(
      sql`UPDATE case_server_confirmations SET revoke_reason = 'other' WHERE id = ${confirmation.id}`.execute(db),
    );
    expect(rewriteReason.code).toBe(FORBIDDEN_OPERATION_SQLSTATE);

    // A new active confirmation for the same (case, server) is allowed after revocation.
    await insertConfirmation(db, { caseId: caseRow.id, serverId: world.server.id, userId: world.user.id });
  });
});
