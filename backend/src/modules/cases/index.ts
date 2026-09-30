/**
 * cases module entry point (registered under /api/v1 by src/modules/index.ts).
 * Exports applyVerdictChange and CasesService for the appeals and reports modules.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import { registerCaseRoutes } from './routes';
import { CasesService } from './service';

export { applyVerdictChange, CasesService } from './service';
export type { AuditCtx, SettableVerdict, VerdictChangeOptions } from './service';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new CasesService(deps);
  await registerCaseRoutes(app, deps, service);
}
