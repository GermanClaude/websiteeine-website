/**
 * whitelist module (§11.6): VPN / account-age whitelist requests and the
 * pending-request expiry job.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import type { JobScheduler } from '../../jobs/scheduler';
import { registerWhitelistRoutes } from './routes';
import { WhitelistService } from './service';

export { WhitelistService, toWhitelistRequestView } from './service';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new WhitelistService(deps);
  await registerWhitelistRoutes(app, deps, service);
}

/** Pending requests past expires_at → 'expired' + WHITELIST_REQUEST_EXPIRED. */
export function registerJobs(scheduler: JobScheduler, deps: Deps): void {
  const service = new WhitelistService(deps);
  scheduler.register('whitelist-requests-expire', 60_000, async () => {
    const { expired } = await service.processExpiredPending();
    return { expired };
  });
}
