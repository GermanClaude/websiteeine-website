/**
 * Retention job (§8.3): prunes player_network_observations
 * (RETENTION_NETWORK_OBSERVATIONS_DAYS) and player_signals
 * (RETENTION_PLAYER_SIGNALS_DAYS, plus rows past their own expires_at).
 * The deletes and the RETENTION_RUN audit event share one transaction.
 */
import { AuditAction } from '@scpsl-trust/shared';

import type { Deps } from '../../container';
import { withTransaction } from '../../db';
import { addDays } from '../../lib/time';
import type { JobScheduler } from '../../jobs/scheduler';
import { SYSTEM_ACTOR } from '../audit/service';

export const RETENTION_JOB_NAME = 'players-retention';
export const RETENTION_JOB_INTERVAL_MS = 60 * 60 * 1000;

export interface RetentionCounts extends Record<string, number> {
  network_observations_deleted: number;
  player_signals_deleted: number;
}

export async function runPlayersRetention(deps: Deps): Promise<RetentionCounts> {
  const now = deps.clock.now();
  const observationCutoff = addDays(now, -deps.config.retention.networkObservationsDays);
  const signalCutoff = addDays(now, -deps.config.retention.playerSignalsDays);
  return withTransaction(deps.db, async (tx) => {
    const observations = await tx
      .deleteFrom('player_network_observations')
      .where('last_seen_at', '<', observationCutoff)
      .executeTakeFirst();
    const signals = await tx
      .deleteFrom('player_signals')
      .where((eb) =>
        eb.or([eb('created_at', '<', signalCutoff), eb.and([eb('expires_at', 'is not', null), eb('expires_at', '<', now)])]),
      )
      .executeTakeFirst();
    const counts: RetentionCounts = {
      network_observations_deleted: Number(observations.numDeletedRows),
      player_signals_deleted: Number(signals.numDeletedRows),
    };
    await deps.audit.record(tx, {
      actor: SYSTEM_ACTOR,
      action: AuditAction.RETENTION_RUN,
      target_type: 'retention',
      target_id: RETENTION_JOB_NAME,
      metadata: { module: 'players', ...counts },
    });
    return counts;
  });
}

export function registerPlayersJobs(scheduler: JobScheduler, deps: Deps): void {
  scheduler.register(RETENTION_JOB_NAME, RETENTION_JOB_INTERVAL_MS, async () => runPlayersRetention(deps));
}
