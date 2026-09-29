/**
 * Registers every feature module under /api/v1 and collects their background jobs.
 * Module agents edit only their own folder; this file wires all of them.
 */
import type { FastifyInstance } from 'fastify';

import { API_PREFIX } from '@scpsl-trust/shared';

import type { Deps } from '../container';
import type { JobScheduler } from '../jobs/scheduler';
import * as appeals from './appeals';
import * as audit from './audit';
import * as auth from './auth';
import * as bypasses from './bypasses';
import * as cases from './cases';
import * as dashboard from './dashboard';
import * as evidence from './evidence';
import * as overwatch from './overwatch';
import * as players from './players';
import * as policies from './policies';
import * as reports from './reports';
import * as servers from './servers';
import * as users from './users';
import * as whitelist from './whitelist';
import type { NamedModule } from './types';

export const MODULES: readonly NamedModule[] = Object.freeze([
  { name: 'auth', module: auth },
  { name: 'users', module: users },
  { name: 'servers', module: servers },
  { name: 'policies', module: policies },
  { name: 'players', module: players },
  { name: 'cases', module: cases },
  { name: 'reports', module: reports },
  { name: 'evidence', module: evidence },
  { name: 'overwatch', module: overwatch },
  { name: 'appeals', module: appeals },
  { name: 'whitelist', module: whitelist },
  { name: 'bypasses', module: bypasses },
  { name: 'dashboard', module: dashboard },
  { name: 'audit', module: audit },
]);

/** Registers all module routes under /api/v1, each in its own encapsulated context. */
export async function registerModules(app: FastifyInstance, deps: Deps, modules: readonly NamedModule[] = MODULES): Promise<void> {
  await app.register(
    async (api) => {
      for (const { module } of modules) {
        await api.register(async (scope) => {
          await module.default(scope, deps);
        });
      }
    },
    { prefix: API_PREFIX },
  );
}

/** Lets every module add its background jobs to the scheduler. */
export function registerModuleJobs(scheduler: JobScheduler, deps: Deps, modules: readonly NamedModule[] = MODULES): void {
  for (const { module } of modules) module.registerJobs?.(scheduler, deps);
}
