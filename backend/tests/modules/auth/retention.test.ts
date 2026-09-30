/**
 * Session/token retention job (§8.3, RETENTION_SESSIONS_DAYS = 30 by default): deletes only
 * sessions/tokens that ended more than the retention window ago, audits RETENTION_RUN.
 */
import { describe, expect, it } from 'vitest';

import { registerJobs } from '../../../src/modules/auth';
import { runSessionsRetention, SESSIONS_RETENTION_JOB_NAME } from '../../../src/modules/auth/jobs';
import { createUser, useTestApp } from '../../helpers';

const NOW = '2026-09-29T12:00:00.000Z';
const DAY_MS = 86_400_000;

describe('auth sessions retention job', () => {
  const t = useTestApp({ now: NOW });

  it('deletes old expired/revoked sessions and used/expired tokens, keeps live ones, audits the run', async () => {
    const deps = t().deps;
    const now = deps.clock.now().getTime();
    const { user } = await createUser(deps);
    const at = (days: number) => new Date(now + days * DAY_MS);
    const session = (tag: string, fields: Record<string, Date | null>) => ({
      user_id: user.id,
      token_hash: tag.repeat(64),
      mfa_verified: false,
      created_at: at(-60),
      last_seen_at: at(-60),
      expires_at: at(1),
      idle_expires_at: at(1),
      revoked_at: null,
      ...fields,
    });
    await deps.db
      .insertInto('sessions')
      .values([
        session('a', { expires_at: at(-31), idle_expires_at: at(-31) }), // expired long ago → deleted
        session('b', { revoked_at: at(-40) }), // revoked long ago → deleted
        session('c', { idle_expires_at: at(-35) }), // idle-expired long ago → deleted
        session('d', { expires_at: at(-2), idle_expires_at: at(-2) }), // expired recently → kept
        session('e', {}), // active → kept
      ])
      .execute();
    const token = (tag: string, fields: Record<string, Date | null>) => ({
      user_id: user.id,
      type: 'password_reset' as const,
      token_hash: tag.repeat(64),
      expires_at: at(1),
      used_at: null,
      created_at: at(-60),
      ...fields,
    });
    await deps.db
      .insertInto('user_tokens')
      .values([
        token('1', { expires_at: at(-31) }), // expired long ago → deleted
        token('2', { used_at: at(-45) }), // used long ago → deleted
        token('3', { used_at: at(-1) }), // used recently → kept
        token('4', {}), // live → kept
      ])
      .execute();

    const counts = await runSessionsRetention(deps);
    expect(counts).toEqual({ sessions_deleted: 3, user_tokens_deleted: 2 });
    const sessions = await deps.db.selectFrom('sessions').select('token_hash').where('user_id', '=', user.id).execute();
    expect(sessions.map((s) => s.token_hash[0]).sort()).toEqual(['d', 'e']);
    const tokens = await deps.db.selectFrom('user_tokens').select('token_hash').where('user_id', '=', user.id).execute();
    expect(tokens.map((s) => s.token_hash[0]).sort()).toEqual(['3', '4']);

    const audit = await deps.db
      .selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'RETENTION_RUN')
      .where('target_id', '=', SESSIONS_RETENTION_JOB_NAME)
      .executeTakeFirstOrThrow();
    expect(audit.metadata).toMatchObject({ module: 'auth', sessions_deleted: 3, user_tokens_deleted: 2 });
    expect((await deps.audit.verifyChain({})).valid).toBe(true);
  });

  it('registerJobs registers the retention job', () => {
    const deps = t().deps;
    registerJobs(deps.scheduler, deps);
    expect(deps.scheduler.names()).toContain(SESSIONS_RETENTION_JOB_NAME);
  });
});
