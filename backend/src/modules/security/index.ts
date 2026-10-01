/**
 * security module (ARCHITECTURE §8, §9, §14): server-side intrusion detection, transient
 * auto-blocking and heuristic anomaly flagging, plus the admin security monitor.
 *
 * The global request observer is registered from app.ts via registerSecurityObserver(); the
 * admin routes and the baseline job live here. All three share the single SecurityService
 * instance on `deps.security` so the observer's samples reach the job.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import type { JobScheduler } from '../../jobs/scheduler';
import { registerSecurityJobs } from './jobs';
import { registerSecurityRoutes } from './routes';

export { AnomalyDetector, type AnomalyFlag, type EwmaState } from './anomaly';
export { registerSecurityObserver } from './observer';
export { SecurityService, type SecuritySource, type SecurityServiceDeps, type SignalContext } from './service';
export { SIGNAL_DEFS, scanRequestMetadata, type SignalKind } from './signals';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  await registerSecurityRoutes(app, deps, deps.security);
}

export function registerJobs(scheduler: JobScheduler, deps: Deps): void {
  registerSecurityJobs(scheduler, deps);
}
