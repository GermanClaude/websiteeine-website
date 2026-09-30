/**
 * Session/token retention job (§8.3, RETENTION_SESSIONS_DAYS): deletes web sessions that expired
 * (absolute or idle) or were revoked, and e-mail verification / password reset tokens that were
 * used or expired, once that happened more than RETENTION_SESSIONS_DAYS ago. Active sessions and
 * live tokens are never touched. The deletes and the RETENTION_RUN audit event share one
 * transaction.
 */
import { AuditAction } from '@scpsl-trust/shared';

import type { Deps } from '../../container';
import { withTransaction } from '../../db';
import type { JobScheduler } from '../../jobs/scheduler';
import { addDays } from '../../lib/time';
import { SYSTEM_ACTOR } from '../audit/service';

export const SESSIONS_RETENTION_JOB_NAME = 'auth-sessions-retention';
export const SESSIONS_RETENTION_JOB_INTERVAL_MS = 60 * 60 * 1000;

export interface SessionsRetentionCounts extends Record<string, number> {
  sessions_deleted: number;
  user_tokens_deleted: number;
}

export async function runSessionsRetention(deps: Deps): Promise<SessionsRetentionCounts> {
  const cutoff = addDays(deps.clock.now(), -deps.config.retention.sessionsDays);
  return withTransaction(deps.db, async (tx) => {
    const sessions = await tx
      .deleteFrom('sessions')
      .where((eb) =>
        eb.or([
          eb('expires_at', '<', cutoff),
          eb('idle_expires_at', '<', cutoff),
          eb.and([eb('revoked_at', 'is not', null), eb('revoked_at', '<', cutoff)]),
        ]),
      )
      .executeTakeFirst();
    const tokens = await tx
      .deleteFrom('user_tokens')
      .where((eb) =>
        eb.or([eb('expires_at', '<', cutoff), eb.and([eb('used_at', 'is not', null), eb('used_at', '<', cutoff)])]),
      )
      .executeTakeFirst();
    const counts: SessionsRetentionCounts = {
      sessions_deleted: Number(sessions.numDeletedRows),
      user_tokens_deleted: Number(tokens.numDeletedRows),
    };
    await deps.audit.record(tx, {
      actor: SYSTEM_ACTOR,
      action: AuditAction.RETENTION_RUN,
      target_type: 'retention',
      target_id: SESSIONS_RETENTION_JOB_NAME,
      metadata: { module: 'auth', ...counts },
    });
    return counts;
  });
}

export function registerAuthJobs(scheduler: JobScheduler, deps: Deps): void {
  scheduler.register(SESSIONS_RETENTION_JOB_NAME, SESSIONS_RETENTION_JOB_INTERVAL_MS, async () => runSessionsRetention(deps));
}
