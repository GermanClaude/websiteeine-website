import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import { useTestDatabase } from '../helpers/test-db';
import { catchPgError } from './assertions';
import {
  ARGON2_HASH,
  createWorld,
  hex64,
  insertAppeal,
  insertAuditEvent,
  insertCase,
  insertConfirmation,
  insertPlayer,
  insertPolicy,
  insertServer,
  insertServerKey,
  insertUser,
  insertWhitelistRequest,
} from './fixtures';
import type { World } from './fixtures';

describe('keys, unique indexes and counters', () => {
  const getDb = useTestDatabase();
  let world: World;

  beforeAll(async () => {
    world = await createWorld(getDb().db);
  });

  describe('partial unique indexes', () => {
    it('allows at most one active key per server (retiring keys may coexist)', async () => {
      const { db } = getDb();
      const server = await insertServer(db, world.user.id);
      const first = await insertServerKey(db, server.id);
      const error = await catchPgError(insertServerKey(db, server.id));
      expect(error).toMatchObject({ code: '23505', constraint: 'server_keys_one_active_key' });

      await db
        .updateTable('server_keys')
        .set({ status: 'retiring', retiring_until: new Date(Date.now() + 600_000) })
        .where('id', '=', first.id)
        .execute();
      await insertServerKey(db, server.id);
    });

    it('allows exactly one active policy version per server', async () => {
      const { db } = getDb();
      const server = await insertServer(db, world.user.id);
      await insertPolicy(db, server.id, { version: 1, is_active: true });
      const error = await catchPgError(insertPolicy(db, server.id, { version: 2, is_active: true }));
      expect(error).toMatchObject({ code: '23505', constraint: 'server_policies_one_active_key' });
      await insertPolicy(db, server.id, { version: 2, is_active: false });
      const duplicateVersion = await catchPgError(insertPolicy(db, server.id, { version: 2, is_active: false }));
      expect(duplicateVersion).toMatchObject({ code: '23505', constraint: 'server_policies_server_id_version_key' });
    });

    it('allows only one unused, unrevoked registration token per server', async () => {
      const { db } = getDb();
      const server = await insertServer(db, world.user.id);
      const token = (seed: string) => ({
        server_id: server.id,
        token_hash: hex64(seed),
        created_by: world.user.id,
        expires_at: new Date(Date.now() + 86_400_000),
      });
      const first = await db.insertInto('server_registration_tokens').values(token('t1')).returning('id').executeTakeFirstOrThrow();
      const error = await catchPgError(db.insertInto('server_registration_tokens').values(token('t2')).execute());
      expect(error).toMatchObject({ code: '23505', constraint: 'server_registration_tokens_one_usable_key' });

      await db.updateTable('server_registration_tokens').set({ revoked_at: new Date() }).where('id', '=', first.id).execute();
      await db.insertInto('server_registration_tokens').values(token('t2')).execute();
      const reused = await catchPgError(db.insertInto('server_registration_tokens').values(token('t1')).execute());
      expect(reused).toMatchObject({ code: '23505', constraint: 'server_registration_tokens_token_hash_key' });
    });

    it('allows one active confirmation per (case, server)', async () => {
      const { db } = getDb();
      const caseRow = await insertCase(db, world.player.id);
      const refs = { caseId: caseRow.id, serverId: world.server.id, userId: world.user.id };
      await insertConfirmation(db, refs);
      const error = await catchPgError(insertConfirmation(db, refs));
      expect(error).toMatchObject({ code: '23505', constraint: 'case_server_confirmations_one_active_key' });
      const otherServer = await insertServer(db, world.user.id);
      await insertConfirmation(db, { ...refs, serverId: otherServer.id });
    });

    it('allows one open (open or under_review) appeal per case', async () => {
      const { db } = getDb();
      const caseRow = await insertCase(db, world.player.id);
      const refs = { caseId: caseRow.id, playerId: world.player.id, userId: world.user.id };
      const appeal = await insertAppeal(db, refs);
      expect((await catchPgError(insertAppeal(db, refs))).constraint).toBe('appeals_one_open_per_case_key');

      await db.updateTable('appeals').set({ status: 'under_review' }).where('id', '=', appeal.id).execute();
      expect((await catchPgError(insertAppeal(db, refs))).constraint).toBe('appeals_one_open_per_case_key');

      await db
        .updateTable('appeals')
        .set({ status: 'decided', decision: 'confirm', decided_by: world.reviewer.id, decided_at: new Date() })
        .where('id', '=', appeal.id)
        .execute();
      await insertAppeal(db, refs);
    });

    it('allows one pending whitelist request per (player, server, type)', async () => {
      const { db } = getDb();
      const player = await insertPlayer(db);
      const refs = { playerId: player.id, userId: world.user.id, serverId: world.server.id };
      const pending = await insertWhitelistRequest(db, refs);
      const error = await catchPgError(insertWhitelistRequest(db, refs));
      expect(error).toMatchObject({ code: '23505', constraint: 'whitelist_requests_one_pending_key' });

      await insertWhitelistRequest(db, refs, { type: 'account_age_whitelist' });
      await db.updateTable('whitelist_requests').set({ status: 'rejected' }).where('id', '=', pending.id).execute();
      await insertWhitelistRequest(db, refs);
    });

    it('allows only one owner membership per server', async () => {
      const { db } = getDb();
      const other = await insertUser(db);
      const error = await catchPgError(
        db
          .insertInto('server_members')
          .values({ server_id: world.server.id, user_id: other.id, role: 'owner', created_by: world.user.id })
          .execute(),
      );
      expect(error).toMatchObject({ code: '23505', constraint: 'server_members_one_owner_key' });
      await db
        .insertInto('server_members')
        .values({ server_id: world.server.id, user_id: other.id, role: 'admin', created_by: world.user.id })
        .execute();
    });

    it('treats usernames case-insensitively and e-mails as citext', async () => {
      const { db } = getDb();
      await insertUser(db, { username: 'CaseTest', email: 'case@example.test' });
      expect((await catchPgError(insertUser(db, { username: 'casetest' }))).constraint).toBe('users_username_key');
      const emailError = await catchPgError(
        sql`INSERT INTO users (email, username, password_hash) VALUES ('CASE@example.test', 'other_case', ${ARGON2_HASH})`.execute(db),
      );
      // upper-case input is rejected outright (e-mails are stored normalized)
      expect(emailError).toMatchObject({ code: '23514', constraint: 'users_email_check' });
      const found = await db.selectFrom('users').select('username').where('email', '=', 'CASE@EXAMPLE.TEST').executeTakeFirst();
      expect(found?.username).toBe('CaseTest');
    });
  });
  describe('case_counters', () => {
    const upsert = (year: number) => sql<{ last_value: number }>`
      INSERT INTO case_counters (year, last_value) VALUES (${year}, 1)
      ON CONFLICT (year) DO UPDATE SET last_value = case_counters.last_value + 1
      RETURNING last_value`;

    it('increments per year', async () => {
      const { db } = getDb();
      const values: number[] = [];
      for (const year of [2031, 2031, 2031, 2032, 2031, 2032]) {
        const result = await upsert(year).execute(db);
        values.push(result.rows[0]?.last_value ?? -1);
      }
      expect(values).toEqual([1, 2, 3, 1, 4, 2]);
    });

    it('never hands out the same value twice under concurrency', async () => {
      const { db } = getDb();
      const results = await Promise.all(Array.from({ length: 25 }, () => upsert(2033).execute(db)));
      const values = results.map((result) => result.rows[0]?.last_value ?? -1).sort((a, b) => a - b);
      expect(values).toEqual(Array.from({ length: 25 }, (_, index) => index + 1));
    });

    it('rejects counters beyond the 6-digit format and invalid years', async () => {
      const { db } = getDb();
      await db.insertInto('case_counters').values({ year: 2040, last_value: 999_999 }).execute();
      expect((await catchPgError(upsert(2040).execute(db))).constraint).toBe('case_counters_last_value_check');
      expect((await catchPgError(upsert(1999).execute(db))).constraint).toBe('case_counters_year_check');
    });
  });
  describe('foreign keys', () => {
    it('restrict deleting referenced rows', async () => {
      const { db } = getDb();
      const serverOwner = await catchPgError(db.deleteFrom('users').where('id', '=', world.user.id).execute());
      expect(serverOwner.code).toBe('23503');
      const playerWithCase = await catchPgError(db.deleteFrom('players').where('id', '=', world.player.id).execute());
      expect(playerWithCase.code).toBe('23503');
      const serverWithKeys = await catchPgError(db.deleteFrom('servers').where('id', '=', world.server.id).execute());
      expect(serverWithKeys.code).toBe('23503');
    });

    it('reject references to missing rows', async () => {
      const { db } = getDb();
      const missing = '00000000-0000-4000-8000-000000000001';
      const error = await catchPgError(insertCase(db, missing));
      expect(error).toMatchObject({ code: '23503', constraint: 'cases_player_id_fkey' });
      const audit = await catchPgError(insertAuditEvent(db, { case_id: missing }));
      expect(audit).toMatchObject({ code: '23503', constraint: 'audit_events_case_id_fkey' });
    });

    it('cascade recovery codes when an otherwise unreferenced user is deleted', async () => {
      const { db } = getDb();
      const user = await insertUser(db);
      await db.insertInto('user_recovery_codes').values({ user_id: user.id, code_hash: hex64(`rc-${user.id}`) }).execute();
      await db.deleteFrom('users').where('id', '=', user.id).execute();
      const codes = await db.selectFrom('user_recovery_codes').select('id').where('user_id', '=', user.id).execute();
      expect(codes).toEqual([]);
    });

    it('allow linking a web account to exactly one player', async () => {
      const { db } = getDb();
      const player = await insertPlayer(db);
      await insertUser(db, { player_id: player.id });
      const error = await catchPgError(insertUser(db, { player_id: player.id }));
      expect(error).toMatchObject({ code: '23505', constraint: 'users_player_id_key' });
    });
  });
});
