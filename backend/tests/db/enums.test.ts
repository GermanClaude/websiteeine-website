import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { DB_ENUMS } from '../../src/db/enums';
import type { DbEnumName } from '../../src/db/enums';
import { useTestDatabase } from '../helpers/test-db';
import { catchPgError, inRolledBackTransaction } from './assertions';
import { createWorld, insertBypass, insertRule } from './fixtures';

interface EnumColumn {
  table: string;
  column: string;
  enumName: DbEnumName;
  /** Restricts the UPDATE to rows where only the enum CHECK can fail. */
  where?: string;
  /**
   * CHECK constraints run in alphabetical order; when another constraint of the
   * row necessarily fails first for an invalid value, it is named here.
   */
  firstFailingConstraint?: string;
  isArray?: boolean;
}

const ENUM_COLUMNS: EnumColumn[] = [
  { table: 'users', column: 'role', enumName: 'user_role' },
  { table: 'users', column: 'status', enumName: 'user_status' },
  { table: 'user_tokens', column: 'type', enumName: 'user_token_type' },
  { table: 'servers', column: 'status', enumName: 'server_status' },
  { table: 'server_members', column: 'role', enumName: 'server_member_role' },
  { table: 'server_keys', column: 'status', enumName: 'server_key_status' },
  { table: 'server_policies', column: 'backend_unavailable_action', enumName: 'backend_unavailable_action' },
  { table: 'server_policy_rules', column: 'signal', enumName: 'policy_signal' },
  { table: 'server_policy_rules', column: 'action', enumName: 'policy_action' },
  {
    table: 'server_policy_rules',
    column: 'statuses',
    enumName: 'global_status',
    isArray: true,
    where: "signal = 'global_verdict'",
  },
  { table: 'server_policy_rules', column: 'min_vpn_confidence', enumName: 'vpn_confidence', where: "signal = 'vpn'" },
  { table: 'server_policy_rules', column: 'min_alt_confidence', enumName: 'alt_confidence', where: "signal = 'alt_account'" },
  {
    table: 'players',
    column: 'id_type',
    enumName: 'player_id_type',
    firstFailingConstraint: 'players_external_id_check',
  },
  { table: 'players', column: 'account_age_source', enumName: 'account_age_source' },
  { table: 'player_signals', column: 'signal', enumName: 'player_signal_type' },
  { table: 'player_signals', column: 'confidence', enumName: 'player_signal_confidence' },
  { table: 'player_links', column: 'signal', enumName: 'alt_signal' },
  { table: 'cases', column: 'current_verdict', enumName: 'case_verdict' },
  { table: 'cases', column: 'status', enumName: 'case_status' },
  {
    table: 'reports',
    column: 'reporter_type',
    enumName: 'reporter_type',
    firstFailingConstraint: 'reports_reporter_check',
  },
  { table: 'reports', column: 'status', enumName: 'report_status' },
  { table: 'reviews', column: 'kind', enumName: 'review_kind' },
  { table: 'reviews', column: 'previous_verdict', enumName: 'case_verdict' },
  { table: 'reviews', column: 'new_verdict', enumName: 'case_verdict' },
  { table: 'evidence', column: 'type', enumName: 'evidence_type' },
  { table: 'evidence', column: 'status', enumName: 'evidence_status' },
  { table: 'evidence', column: 'identity_status', enumName: 'evidence_status' },
  { table: 'evidence', column: 'authenticity_status', enumName: 'evidence_status' },
  { table: 'evidence', column: 'cheating_status', enumName: 'evidence_status' },
  { table: 'evidence_reviews', column: 'status', enumName: 'evidence_status' },
  { table: 'evidence_reviews', column: 'identity_status', enumName: 'evidence_status' },
  { table: 'evidence_reviews', column: 'authenticity_status', enumName: 'evidence_status' },
  { table: 'evidence_reviews', column: 'cheating_status', enumName: 'evidence_status' },
  { table: 'overwatch_sessions', column: 'status', enumName: 'overwatch_session_status' },
  { table: 'appeals', column: 'status', enumName: 'appeal_status', where: 'decision IS NULL' },
  { table: 'appeals', column: 'decision', enumName: 'appeal_decision', where: "status = 'decided'" },
  { table: 'whitelist_requests', column: 'type', enumName: 'whitelist_request_type' },
  { table: 'whitelist_requests', column: 'status', enumName: 'whitelist_request_status' },
  { table: 'bypasses', column: 'scope', enumName: 'bypass_scope', where: 'server_id IS NULL' },
  { table: 'bypasses', column: 'type', enumName: 'bypass_type' },
  { table: 'audit_events', column: 'actor_type', enumName: 'actor_type' },
  { table: 'audit_events', column: 'action', enumName: 'audit_action' },
  { table: 'job_runs', column: 'result', enumName: 'job_run_result', where: "result <> 'running'" },
];

function enumConstraintName(entry: EnumColumn): string {
  return `${entry.table}_${entry.column}_check`;
}

describe('enum CHECK constraints', () => {
  const getDb = useTestDatabase();

  beforeAll(async () => {
    const { db } = getDb();
    const world = await createWorld(db);
    // Rows on which only the enum constraint under test can fail.
    await insertRule(db, world.policy.id, { signal: 'vpn', statuses: null, min_vpn_confidence: 'likely' });
    await insertRule(db, world.policy.id, { signal: 'alt_account', statuses: null, min_alt_confidence: 'medium' });
    await insertBypass(db, { playerId: world.player.id, grantedByUserId: world.user.id, serverId: null });
    await db
      .insertInto('appeals')
      .values({
        case_id: world.caseRow.id,
        player_id: world.player.id,
        submitted_by_user_id: world.user.id,
        statement: 'A second appeal that was already decided.',
        status: 'decided',
        decision: 'confirm',
      })
      .execute();
    await db.insertInto('job_runs').values({ job: 'retention', result: 'succeeded', finished_at: new Date() }).execute();
  });

  it('lists exactly the values of DB_ENUMS in every enum CHECK constraint', async () => {
    const { db } = getDb();
    const result = await sql<{ conname: string; definition: string }>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE contype = 'c' AND connamespace = 'public'::regnamespace
    `.execute(db);
    const definitions = new Map(result.rows.map((row) => [row.conname, row.definition]));

    for (const entry of ENUM_COLUMNS) {
      const definition = definitions.get(enumConstraintName(entry));
      expect(definition, enumConstraintName(entry)).toBeDefined();
      const values = [...(definition ?? '').matchAll(/'([^']*)'::text/g)].map((match) => match[1]);
      expect([...values].sort(), enumConstraintName(entry)).toEqual([...DB_ENUMS[entry.enumName]].sort());
    }
  });

  it('covers every single-column IN-list CHECK constraint of the schema', async () => {
    const { db } = getDb();
    const result = await sql<{ conname: string }>`
      SELECT conname
      FROM pg_constraint
      WHERE contype = 'c' AND connamespace = 'public'::regnamespace
        AND (pg_get_constraintdef(oid) ~ '^CHECK \\(\\(\\w+ = ANY \\(ARRAY\\[[^]]*\\]\\)\\)\\)$'
             OR pg_get_constraintdef(oid) ~ '^CHECK \\(\\(\\w+ <@ ARRAY\\[')
      ORDER BY conname
    `.execute(db);
    const covered = new Set(ENUM_COLUMNS.map(enumConstraintName));
    expect(result.rows.map((row) => row.conname).filter((name) => !covered.has(name))).toEqual([]);
    expect(result.rows.length).toBe(ENUM_COLUMNS.length);
  });

  describe.each(ENUM_COLUMNS)('$table.$column', (entry) => {
    const valid = DB_ENUMS[entry.enumName][0];
    // Case matters: the case-flipped spelling of a valid value is invalid too.
    const flipped = valid === valid.toUpperCase() ? valid.toLowerCase() : valid.toUpperCase();
    const invalidValues = ['definitely_not_valid', flipped, ` ${valid}`, ''];

    it.each(invalidValues)('rejects %j', async (invalid) => {
      const { db } = getDb();
      const error = await inRolledBackTransaction(db, async (trx) => {
        // Skip protection triggers (append-only tables) so only CHECK constraints apply.
        await sql`SET LOCAL session_replication_role = replica`.execute(trx);
        const value = entry.isArray === true ? sql`ARRAY[${invalid}]::text[]` : sql`${invalid}`;
        const where = entry.where !== undefined ? sql` WHERE ${sql.raw(entry.where)}` : sql``;
        const update = sql`UPDATE ${sql.table(entry.table)} SET ${sql.ref(entry.column)} = ${value}${where}`;
        const probe = await sql<{ n: number }>`SELECT count(*)::int AS n FROM ${sql.table(entry.table)}${where}`.execute(trx);
        expect(probe.rows[0]?.n ?? 0, 'fixture row missing').toBeGreaterThan(0);
        return catchPgError(update.execute(trx));
      });
      expect(error.code).toBe('23514');
      expect(error.constraint).toBe(entry.firstFailingConstraint ?? enumConstraintName(entry));
    });
  });
});
