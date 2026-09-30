/**
 * Retention job (§8.3): prunes old network observations and player signals,
 * keeps fresh rows, audits RETENTION_RUN with counts, and is registered.
 */
import { describe, expect, it } from 'vitest';

import { registerJobs } from '../../../src/modules/players';
import { RETENTION_JOB_NAME, runPlayersRetention } from '../../../src/modules/players/jobs';
import { createPlayer, createServerWithKey, useTestApp } from '../../helpers';

const NOW = '2026-09-29T12:00:00.000Z';
const DAY_MS = 86_400_000;
const HEX = (c: string) => c.repeat(64);

describe('players retention job', () => {
  const t = useTestApp({ now: NOW });

  it('deletes only rows past the retention windows and audits the run', async () => {
    const deps = t().deps;
    const now = deps.clock.now();
    const player = await createPlayer(deps);
    const srv = await createServerWithKey(deps);

    await deps.db
      .insertInto('player_network_observations')
      .values([
        { player_id: player.id, network_hash: HEX('a'), prefix_hash: HEX('b'), server_id: srv.server.id, first_seen_at: now, last_seen_at: new Date(now.getTime() - 31 * DAY_MS), seen_count: 1 },
        { player_id: player.id, network_hash: HEX('c'), prefix_hash: HEX('d'), server_id: srv.server.id, first_seen_at: now, last_seen_at: new Date(now.getTime() - 5 * DAY_MS), seen_count: 1 },
      ])
      .execute();
    await deps.db
      .insertInto('player_signals')
      .values([
        { player_id: player.id, server_id: srv.server.id, signal: 'vpn_detected', confidence: 'likely', source: 'test', detail_codes: [], created_at: new Date(now.getTime() - 91 * DAY_MS) },
        { player_id: player.id, server_id: srv.server.id, signal: 'young_account', confidence: null, source: 'test', detail_codes: [], created_at: new Date(now.getTime() - 10 * DAY_MS) },
        // Fresh row that expired on its own schedule.
        { player_id: player.id, server_id: srv.server.id, signal: 'vpn_detected', confidence: 'likely', source: 'test', detail_codes: [], created_at: now, expires_at: new Date(now.getTime() - 1000) },
      ])
      .execute();

    const counts = await runPlayersRetention(deps);
    expect(counts).toEqual({ network_observations_deleted: 1, player_signals_deleted: 2 });

    const observations = await deps.db.selectFrom('player_network_observations').selectAll().execute();
    expect(observations).toHaveLength(1);
    expect(observations[0]!.network_hash).toBe(HEX('c'));
    const signals = await deps.db.selectFrom('player_signals').selectAll().execute();
    expect(signals).toHaveLength(1);
    expect(signals[0]!.signal).toBe('young_account');

    const audit = await deps.db
      .selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'RETENTION_RUN')
      .executeTakeFirstOrThrow();
    expect(audit.actor_type).toBe('system');
    expect(audit.metadata).toMatchObject({ module: 'players', network_observations_deleted: 1, player_signals_deleted: 2 });
    expect((await deps.audit.verifyChain({})).valid).toBe(true);
  });

  it('a run with nothing to delete still audits with zero counts', async () => {
    const counts = await runPlayersRetention(t().deps);
    expect(counts).toEqual({ network_observations_deleted: 0, player_signals_deleted: 0 });
  });

  it('registerJobs registers the retention job on the scheduler', () => {
    const deps = t().deps;
    registerJobs(deps.scheduler, deps);
    expect(deps.scheduler.names()).toContain(RETENTION_JOB_NAME);
  });
});
