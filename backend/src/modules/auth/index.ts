/**
 * auth module entry point (registered under /api/v1 by src/modules/index.ts).
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import type { JobScheduler } from '../../jobs/scheduler';
import { registerAuthJobs } from './jobs';
import { registerAuthRoutes } from './routes';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  await registerAuthRoutes(app, deps);
}

/** §8.3: session/token retention (RETENTION_SESSIONS_DAYS). */
export function registerJobs(scheduler: JobScheduler, deps: Deps): void {
  registerAuthJobs(scheduler, deps);
}
