/**
 * servers module: registration/identity/keys/members (§4.2, §5) — plugin routes,
 * web management routes and the key-retirement job.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import type { JobScheduler } from '../../jobs/scheduler';
import { retireExpiredKeys } from './repository';
import { registerServerPluginRoutes } from './plugin-routes';
import { registerServerWebRoutes } from './routes';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  await registerServerPluginRoutes(app, deps);
  await registerServerWebRoutes(app, deps);
}

/** Moves `retiring` keys whose grace window ended to `retired` (§5.5). */
export function registerJobs(scheduler: JobScheduler, deps: Deps): void {
  scheduler.register('server-keys-retire', 60_000, async () => {
    const retired = await retireExpiredKeys(deps.db, deps.clock.now());
    return { retired };
  });
}
