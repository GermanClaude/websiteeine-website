/**
 * overwatch module entry point (registered under /api/v1 by src/modules/index.ts).
 * Routes: §10 (plugin session lifecycle, proof API) + §13 web views.
 * Jobs: heartbeat expiry and secret retention (§10.1, §8.3).
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import type { JobScheduler } from '../../jobs/scheduler';
import { expireStaleSessions, wipeExpiredSecrets } from './repository';
import { registerOverwatchPluginRoutes } from './plugin-routes';
import { registerOverwatchRoutes } from './routes';
import { OverwatchService } from './service';

export { OverwatchService } from './service';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new OverwatchService(deps);
  await registerOverwatchPluginRoutes(app, deps, service);
  await registerOverwatchRoutes(app, deps, service);
}

export function registerJobs(scheduler: JobScheduler, deps: Deps): void {
  // Active sessions without a heartbeat for > OVERWATCH_HEARTBEAT_TIMEOUT_SECONDS → expired,
  // end_reason heartbeat_timeout; effective end = last_heartbeat_at + interval (§10.1).
  scheduler.register('overwatch-expire-sessions', 30_000, async () => {
    const cutoff = new Date(deps.clock.now().getTime() - deps.config.overwatch.heartbeatTimeoutSeconds * 1000);
    const expired = await expireStaleSessions(deps.db, cutoff);
    return { expired: expired.length };
  });

  // Wipe encrypted secrets after RETENTION_OVERWATCH_SECRETS_DAYS (row kept; proof
  // verification then answers valid:false / secret_expired).
  scheduler.register('overwatch-wipe-secrets', 3_600_000, async () => {
    const cutoff = new Date(
      deps.clock.now().getTime() - deps.config.retention.overwatchSecretsDays * 86_400_000,
    );
    const wiped = await wipeExpiredSecrets(deps.db, cutoff);
    return { wiped };
  });
}
