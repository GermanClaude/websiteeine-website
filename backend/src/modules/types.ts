/**
 * Contract between the core and feature modules.
 *
 * Each module folder exports from its index.ts:
 *   export default async function register(app: FastifyInstance, deps: Deps): Promise<void>
 *   export function registerJobs(scheduler: JobScheduler, deps: Deps): void   // optional
 *
 * `app` is an encapsulated child instance with prefix /api/v1: hooks a module adds stay
 * inside that module.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../container';
import type { JobScheduler } from '../jobs/scheduler';

export interface BackendModule {
  default: (app: FastifyInstance, deps: Deps) => Promise<void>;
  registerJobs?: (scheduler: JobScheduler, deps: Deps) => void;
}

export interface NamedModule {
  readonly name: string;
  readonly module: BackendModule;
}
