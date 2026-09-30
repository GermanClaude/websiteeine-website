/**
 * bypasses module (§4.8, §11.6): server-scoped and global bypass management plus
 * the bypass expiry job. Exports BypassService/getActiveBypasses for the players module.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import type { JobScheduler } from '../../jobs/scheduler';
import { registerBypassRoutes } from './routes';
import { BypassService } from './service';

export { BypassService, getActiveBypasses, toBypassView } from './service';
export type { ActiveBypass } from './repository';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new BypassService(deps);
  await registerBypassRoutes(app, deps, service);
}

/** Expired bypasses → expired_processed_at + BYPASS_EXPIRED (+ approved requests → expired). */
export function registerJobs(scheduler: JobScheduler, deps: Deps): void {
  const service = new BypassService(deps);
  scheduler.register('bypasses-expire', 60_000, async () => {
    const { expired, requests_expired } = await service.processExpiredBypasses();
    return { expired, requests_expired };
  });
}
