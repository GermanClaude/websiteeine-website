import { sql } from 'kysely';
import { beforeAll, describe, expect, it } from 'vitest';

import type { NewServerPolicyRule } from '../../src/db/types';
import { useTestDatabase } from '../helpers/test-db';
import { catchPgError } from './assertions';
import {
  createWorld,
  hex64,
  insertAppeal,
  insertAuditEvent,
  insertBypass,
  insertCase,
  insertEvidence,
  insertLinkEvidence,
  insertOverwatchSession,
  insertPlayer,
  insertReport,
  insertRule,
  insertServer,
  insertServerKey,
  insertUser,
  insertWhitelistRequest,
  publicKeyFor,
} from './fixtures';
import type { World } from './fixtures';

describe('CHECK constraints', () => {
  const getDb = useTestDatabase();
  let world: World;

  beforeAll(async () => {
    world = await createWorld(getDb().db);
  });

  describe('bypass scope', () => {
    it('requires server_id exactly for server-scoped bypasses', async () => {
      const { db } = getDb();
      const refs = { playerId: world.player.id, grantedByUserId: world.user.id };
      await insertBypass(db, { ...refs, serverId: world.server.id });
      await insertBypass(db, { ...refs, serverId: null });

      const serverWithoutId = await catchPgError(insertBypass(db, { ...refs, serverId: null }, { scope: 'server' }));
      expect(serverWithoutId.constraint).toBe('bypasses_scope_server_check');
      const globalWithServer = await catchPgError(insertBypass(db, { ...refs, serverId: world.server.id }, { scope: 'global' }));
      expect(globalWithServer.constraint).toBe('bypasses_scope_server_check');
    });
  });
  describe('server_policy_rules condition columns', () => {
    const valid: [string, Partial<NewServerPolicyRule>][] = [
      ['global_verdict', { signal: 'global_verdict', statuses: ['confirmed', 'under_review'], min_confirmed_servers: 2 }],
      ['global_verdict with min 0 servers', { signal: 'global_verdict', statuses: ['confirmed'], min_confirmed_servers: 0 }],
      ['account_age with days', { signal: 'account_age', statuses: null, max_account_age_days: 7, match_unknown_age: false }],
      ['account_age unknown only', { signal: 'account_age', statuses: null, match_unknown_age: true }],
      ['vpn', { signal: 'vpn', statuses: null, min_vpn_confidence: 'likely', action: 'require_whitelist' }],
      ['alt_account', { signal: 'alt_account', statuses: null, min_alt_confidence: 'medium', require_linked_confirmed_case: true }],
      ['open_reports', { signal: 'open_reports', statuses: null, min_open_reports: 3, action: 'warn' }],
      ['permanent ban', { signal: 'global_verdict', statuses: ['confirmed'], action: 'ban', ban_duration_minutes: 0 }],
      ['ban without duration', { signal: 'global_verdict', statuses: ['confirmed'], action: 'ban' }],
    ];

    const invalid: [string, Partial<NewServerPolicyRule>, string][] = [
      ['global_verdict without statuses', { signal: 'global_verdict', statuses: null }, 'server_policy_rules_global_verdict_check'],
      ['global_verdict with empty statuses', { signal: 'global_verdict', statuses: [] }, 'server_policy_rules_global_verdict_check'],
      [
        'global_verdict with a vpn condition',
        { signal: 'global_verdict', statuses: ['confirmed'], min_vpn_confidence: 'likely' },
        'server_policy_rules_global_verdict_check',
      ],
      ['account_age without condition', { signal: 'account_age', statuses: null }, 'server_policy_rules_account_age_check'],
      [
        'account_age with match_unknown_age=false only',
        { signal: 'account_age', statuses: null, match_unknown_age: false },
        'server_policy_rules_account_age_check',
      ],
      [
        'account_age with statuses',
        { signal: 'account_age', statuses: ['confirmed'], max_account_age_days: 3 },
        'server_policy_rules_account_age_check',
      ],
      ['vpn without confidence', { signal: 'vpn', statuses: null }, 'server_policy_rules_vpn_check'],
      [
        'vpn with an alt condition',
        { signal: 'vpn', statuses: null, min_vpn_confidence: 'likely', min_alt_confidence: 'low' },
        'server_policy_rules_vpn_check',
      ],
      ['alt_account without confidence', { signal: 'alt_account', statuses: null }, 'server_policy_rules_alt_account_check'],
      [
        'alt_account with min_open_reports',
        { signal: 'alt_account', statuses: null, min_alt_confidence: 'low', min_open_reports: 1 },
        'server_policy_rules_alt_account_check',
      ],
      ['open_reports without threshold', { signal: 'open_reports', statuses: null }, 'server_policy_rules_open_reports_check'],
      [
        'open_reports with require_linked_confirmed_case',
        { signal: 'open_reports', statuses: null, min_open_reports: 1, require_linked_confirmed_case: false },
        'server_policy_rules_open_reports_check',
      ],
      ['ban duration on a kick rule', { action: 'kick', ban_duration_minutes: 60 }, 'server_policy_rules_ban_duration_check'],
      ['negative ban duration', { action: 'ban', ban_duration_minutes: -1 }, 'server_policy_rules_ban_duration_check'],
      [
        'too many confirmed servers',
        { signal: 'global_verdict', statuses: ['confirmed'], min_confirmed_servers: 1001 },
        'server_policy_rules_min_confirmed_servers_check',
      ],
      ['zero account age', { signal: 'account_age', statuses: null, max_account_age_days: 0 }, 'server_policy_rules_max_account_age_days_check'],
      ['zero open reports', { signal: 'open_reports', statuses: null, min_open_reports: 0 }, 'server_policy_rules_min_open_reports_check'],
      ['message over 256 chars', { message: 'x'.repeat(257) }, 'server_policy_rules_message_check'],
      ['negative sort order', { sort_order: -1 }, 'server_policy_rules_sort_order_check'],
    ];

    it.each(valid)('accepts %s', async (_name, overrides) => {
      const { db } = getDb();
      await insertRule(db, world.policy.id, overrides);
    });

    it.each(invalid)('rejects %s', async (_name, overrides, constraint) => {
      const { db } = getDb();
      const error = await catchPgError(insertRule(db, world.policy.id, overrides));
      expect(error).toMatchObject({ code: '23514', constraint });
    });

    it('rejects NULL elements in statuses', async () => {
      const { db } = getDb();
      const error = await catchPgError(
        sql`INSERT INTO server_policy_rules (policy_id, sort_order, signal, action, statuses)
            VALUES (${world.policy.id}, 9001, 'global_verdict', 'warn', ARRAY['confirmed', NULL]::text[])`.execute(db),
      );
      expect(error).toMatchObject({ code: '23514', constraint: 'server_policy_rules_statuses_check' });
    });

    it('rejects duplicate sort_order within a policy', async () => {
      const { db } = getDb();
      await insertRule(db, world.policy.id, { sort_order: 5000 });
      const error = await catchPgError(insertRule(db, world.policy.id, { sort_order: 5000 }));
      expect(error).toMatchObject({ code: '23505', constraint: 'server_policy_rules_policy_id_sort_order_key' });
    });
  });
  describe('evidence content', () => {
    const refs = () => ({ caseId: world.caseRow.id, uploaderUserId: world.user.id });

    it.each([
      ['link without URL', { type: 'link', external_url: null, sha256: null, size_bytes: null, storage_key: null }],
      ['link with a hash', { type: 'link', external_url: 'https://v.example.test/1', size_bytes: null, storage_key: null }],
      ['file without hash', { sha256: null }],
      ['file without storage key', { storage_key: null }],
      ['file without size', { size_bytes: null }],
      ['file without mime type', { mime_type: null }],
      ['file with an external URL', { external_url: 'https://v.example.test/2' }],
    ] as const)('rejects %s', async (_name, overrides) => {
      const { db } = getDb();
      const error = await catchPgError(insertEvidence(db, refs(), overrides));
      expect(error).toMatchObject({ code: '23514', constraint: 'evidence_content_check' });
    });

    it('accepts https link evidence and rejects other schemes', async () => {
      const { db } = getDb();
      await insertLinkEvidence(db, refs());
      await insertLinkEvidence(db, refs(), { external_url: 'HTTPS://videos.example.test/upper' });
      for (const url of ['http://v.example.test/1', 'javascript:alert(1)', 'ftp://v.example.test/1']) {
        const error = await catchPgError(insertLinkEvidence(db, refs(), { external_url: url }));
        expect(error.constraint).toBe('evidence_external_url_check');
      }
    });

    it('rejects malformed hashes and missing uploader', async () => {
      const { db } = getDb();
      for (const sha256 of ['ABC', hex64('x').toUpperCase(), `${hex64('x').slice(0, 63)}g`]) {
        expect((await catchPgError(insertEvidence(db, refs(), { sha256 }))).constraint).toBe('evidence_sha256_check');
      }
      const noUploader = await catchPgError(insertEvidence(db, refs(), { uploader_user_id: null }));
      expect(noUploader.constraint).toBe('evidence_uploader_check');
      const negativeSize = await catchPgError(insertEvidence(db, refs(), { size_bytes: -1 }));
      expect(negativeSize.constraint).toBe('evidence_size_bytes_check');
    });
  });
  describe('identifier and privacy formats', () => {
    it('validates server ids, keys and fingerprints', async () => {
      const { db } = getDb();
      for (const serverId of ['srv_ABCDEFGHJKMNPQRS', 'srv_0000000000000i00', 'srv_short', 'xyz_0000000000000000']) {
        const error = await catchPgError(insertServer(db, world.user.id, { server_id: serverId }));
        expect(error.constraint).toBe('servers_server_id_check');
      }
      const server = await insertServer(db, world.user.id);
      const badKey = await catchPgError(insertServerKey(db, server.id, { public_key: 'not-base64' }));
      expect(badKey.constraint).toBe('server_keys_public_key_check');
      const badFingerprint = await catchPgError(
        insertServerKey(db, server.id, { public_key: publicKeyFor(424242), fingerprint: 'SHA256:ABC' }),
      );
      expect(badFingerprint.constraint).toBe('server_keys_fingerprint_check');
    });

    it('validates player external ids per identity type', async () => {
      const { db } = getDb();
      await insertPlayer(db, { id_type: 'discord', external_id: '123456789012345678' });
      await insertPlayer(db, { id_type: 'northwood', external_id: 'nw.staff-1' });
      for (const [idType, externalId] of [
        ['steam', '1234'],
        ['steam', '7656119800000000a'],
        ['discord', '1'.repeat(21)],
        ['northwood', 'Upper'],
        ['northwood', "x'; DROP TABLE players; --"],
      ] as const) {
        const error = await catchPgError(insertPlayer(db, { id_type: idType, external_id: externalId }));
        expect(error.constraint).toBe('players_external_id_check');
      }
    });

    it('never accepts raw IP addresses in network hashes or signal codes', async () => {
      const { db } = getDb();
      const observation = (networkHash: string, prefixHash: string) =>
        db
          .insertInto('player_network_observations')
          .values({ player_id: world.otherPlayer.id, network_hash: networkHash, prefix_hash: prefixHash, server_id: world.server.id })
          .execute();
      expect((await catchPgError(observation('203.0.113.4', hex64('p')))).constraint).toBe(
        'player_network_observations_network_hash_check',
      );
      expect((await catchPgError(observation(hex64('n'), '2001:db8::/48'))).constraint).toBe(
        'player_network_observations_prefix_hash_check',
      );

      const signal = (detailCodes: string[], source = 'alt') =>
        db
          .insertInto('player_signals')
          .values({ player_id: world.player.id, signal: 'possible_alt_account', source, detail_codes: detailCodes })
          .execute();
      await signal(['same_network_identifier', 'network_is_vpn']);
      for (const codes of [['203.0.113.4'], ['2001:db8::1'], [''], ['UPPER']]) {
        expect((await catchPgError(signal(codes))).constraint).toBe('player_signals_detail_codes_check');
      }
      expect((await catchPgError(signal([], '203.0.113.4'))).constraint).toBe('player_signals_source_check');

      const session = await catchPgError(
        db
          .insertInto('sessions')
          .values({
            user_id: world.user.id,
            token_hash: hex64('s-ip'),
            mfa_verified: false,
            expires_at: new Date(),
            idle_expires_at: new Date(),
            ip_hash: '198.51.100.7',
          })
          .execute(),
      );
      expect(session.constraint).toBe('sessions_ip_hash_check');
    });

    it('rejects plaintext passwords, unnormalized e-mails and unencrypted secrets', async () => {
      const { db } = getDb();
      expect((await catchPgError(insertUser(db, { password_hash: 'hunter2hunter2' }))).constraint).toBe(
        'users_password_hash_check',
      );
      expect((await catchPgError(insertUser(db, { email: 'not-an-email' }))).constraint).toBe('users_email_check');
      expect((await catchPgError(insertUser(db, { username: 'a b' }))).constraint).toBe('users_username_check');
      expect((await catchPgError(insertUser(db, { totp_secret_enc: 'JBSWY3DPEHPK3PXP' }))).constraint).toBe(
        'users_totp_secret_check',
      );
      expect((await catchPgError(insertUser(db, { totp_enabled_at: new Date() }))).constraint).toBe('users_totp_enabled_check');
      const overwatch = await catchPgError(
        insertOverwatchSession(
          db,
          { serverId: world.server.id, targetPlayerId: world.player.id, spectatorPlayerId: world.otherPlayer.id },
          { secret_enc: Buffer.alloc(32).toString('base64') },
        ),
      );
      expect(overwatch.constraint).toBe('overwatch_sessions_secret_enc_check');
    });

    it('validates case numbers', async () => {
      const { db } = getDb();
      for (const caseNumber of ['CASE-26-000001', 'CASE-2026-1', 'case-2026-000001', 'CASE-2026-0000001']) {
        const error = await catchPgError(insertCase(db, world.player.id, { case_number: caseNumber }));
        expect(error.constraint).toBe('cases_case_number_check');
      }
      const duplicate = await catchPgError(insertCase(db, world.player.id, { case_number: world.caseRow.case_number }));
      expect(duplicate.constraint).toBe('cases_case_number_key');
    });
  });
  describe('state consistency checks', () => {
    it('reports name their reporter', async () => {
      const { db } = getDb();
      const refs = { caseId: world.caseRow.id, playerId: world.player.id, reporterUserId: world.user.id };
      expect((await catchPgError(insertReport(db, refs, { reporter_user_id: null }))).constraint).toBe('reports_reporter_check');
      expect(
        (await catchPgError(insertReport(db, refs, { reporter_type: 'server', reporter_user_id: null, server_id: null }))).constraint,
      ).toBe('reports_reporter_check');
      await insertReport(db, refs, { reporter_type: 'server', reporter_user_id: null, server_id: world.server.id });
      expect((await catchPgError(insertReport(db, refs, { reason: '' }))).constraint).toBe('reports_reason_check');
    });

    it('closed cases have closed_at; decided appeals have a decision', async () => {
      const { db } = getDb();
      expect((await catchPgError(insertCase(db, world.player.id, { status: 'closed' }))).constraint).toBe('cases_closed_at_check');
      await insertCase(db, world.player.id, { status: 'closed', closed_at: new Date() });

      const caseRow = await insertCase(db, world.player.id);
      const refs = { caseId: caseRow.id, playerId: world.player.id, userId: world.user.id };
      expect((await catchPgError(insertAppeal(db, refs, { status: 'decided' }))).constraint).toBe('appeals_decided_check');
      expect((await catchPgError(insertAppeal(db, refs, { decision: 'reverse' }))).constraint).toBe('appeals_decided_check');
      expect((await catchPgError(insertAppeal(db, refs, { statement: 'too short' }))).constraint).toBe('appeals_statement_check');
    });

    it('key status columns carry their timestamps', async () => {
      const { db } = getDb();
      const server = await insertServer(db, world.user.id);
      expect((await catchPgError(insertServerKey(db, server.id, { status: 'retiring' }))).constraint).toBe(
        'server_keys_retiring_check',
      );
      expect((await catchPgError(insertServerKey(db, server.id, { status: 'revoked' }))).constraint).toBe(
        'server_keys_revoked_check',
      );
      expect((await catchPgError(insertServerKey(db, server.id, { status: 'retired' }))).constraint).toBe(
        'server_keys_retired_check',
      );
    });

    it('approved whitelist requests reference their bypass', async () => {
      const { db } = getDb();
      const player = await insertPlayer(db);
      const refs = { playerId: player.id, userId: world.user.id, serverId: world.server.id };
      const request = await insertWhitelistRequest(db, refs);
      const missingBypass = await catchPgError(
        db.updateTable('whitelist_requests').set({ status: 'approved' }).where('id', '=', request.id).execute(),
      );
      expect(missingBypass.constraint).toBe('whitelist_requests_approved_check');

      const bypass = await insertBypass(
        db,
        { playerId: player.id, grantedByUserId: world.user.id, serverId: world.server.id },
        { whitelist_request_id: request.id },
      );
      await db
        .updateTable('whitelist_requests')
        .set({ status: 'approved', bypass_id: bypass.id, decided_by: world.user.id, decided_at: new Date() })
        .where('id', '=', request.id)
        .execute();
      const secondBypass = await catchPgError(
        insertBypass(
          db,
          { playerId: player.id, grantedByUserId: world.user.id, serverId: world.server.id },
          { whitelist_request_id: request.id },
        ),
      );
      expect(secondBypass.constraint).toBe('bypasses_whitelist_request_id_key');
      expect((await catchPgError(insertWhitelistRequest(db, refs, { reason: 'short' }))).constraint).toBe(
        'whitelist_requests_reason_check',
      );
      expect((await catchPgError(insertWhitelistRequest(db, refs, { requested_days: 366 }))).constraint).toBe(
        'whitelist_requests_requested_days_check',
      );
    });

    it('player links cannot point to the same player', async () => {
      const { db } = getDb();
      const error = await catchPgError(
        db
          .insertInto('player_links')
          .values({ player_id: world.player.id, linked_player_id: world.player.id, signal: 'same_network_prefix' })
          .execute(),
      );
      expect(error.constraint).toBe('player_links_not_self_check');
    });

    it('overwatch intervals stay within 5-60 seconds', async () => {
      const { db } = getDb();
      const refs = { serverId: world.server.id, targetPlayerId: world.player.id, spectatorPlayerId: world.otherPlayer.id };
      for (const interval of [4, 61]) {
        const error = await catchPgError(insertOverwatchSession(db, refs, { interval_seconds: interval }));
        expect(error.constraint).toBe('overwatch_sessions_interval_seconds_check');
      }
      await insertOverwatchSession(db, refs, { interval_seconds: 5 });
      await insertOverwatchSession(db, refs, { interval_seconds: 60 });
    });
  });
  describe('audit_events', () => {
    it('rejects a forked chain, microsecond timestamps and non-object metadata', async () => {
      const { db } = getDb();
      const head = await insertAuditEvent(db);
      const fork = await catchPgError(
        db
          .insertInto('audit_events')
          .values({
            seq: head.seq + 100,
            event_id: '00000000-0000-4000-8000-00000000f0f0',
            created_at: new Date(),
            actor_type: 'system',
            action: 'RETENTION_RUN',
            target_type: 'system',
            prev_hash: head.prev_hash,
            hash: hex64('fork'),
          })
          .execute(),
      );
      expect(fork).toMatchObject({ code: '23505', constraint: 'audit_events_prev_hash_key' });

      const micro = await catchPgError(insertAuditEvent(db, { created_at: '2026-09-29T15:42:20.123456Z' }));
      expect(micro.constraint).toBe('audit_events_created_at_check');

      const arrayMetadata = await catchPgError(
        sql`INSERT INTO audit_events (seq, event_id, created_at, actor_type, action, target_type, metadata, prev_hash, hash)
            VALUES (${head.seq + 200}, gen_random_uuid(), date_trunc('milliseconds', now()), 'system', 'RETENTION_RUN', 'system',
                    '[1,2]'::jsonb, ${head.hash}, ${hex64('arr')})`.execute(db),
      );
      expect(arrayMetadata.constraint).toBe('audit_events_metadata_check');

      const selfHash = await catchPgError(insertAuditEvent(db, { hash: head.hash.replace(/./g, 'a'), prev_hash: head.hash.replace(/./g, 'a') }));
      expect(['audit_events_hash_check', 'audit_events_prev_hash_key']).toContain(selfHash.constraint);

      const badAction = await catchPgError(
        sql`INSERT INTO audit_events (seq, event_id, created_at, actor_type, action, target_type, prev_hash, hash)
            VALUES (${head.seq + 300}, gen_random_uuid(), date_trunc('milliseconds', now()), 'system', 'report_created', 'system',
                    ${head.hash}, ${hex64('upper')})`.execute(db),
      );
      expect(badAction.constraint).toBe('audit_events_action_check');
    });

    it('stores metadata and scope columns', async () => {
      const { db } = getDb();
      const event = await insertAuditEvent(db, {
        metadata: { reason: 'test', nested: { count: 2 } },
        server_id: world.server.id,
        case_id: world.caseRow.id,
        actor_type: 'user',
        actor_id: world.user.id,
        action: 'CASE_CREATED',
        target_type: 'case',
        target_id: world.caseRow.case_number,
      });
      expect(event.metadata).toEqual({ reason: 'test', nested: { count: 2 } });
      expect(event.created_at).toBeInstanceOf(Date);
      expect(typeof event.seq).toBe('number');
    });
  });
});
