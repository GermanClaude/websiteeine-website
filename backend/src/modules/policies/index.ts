/**
 * policies module: versioned server policies (§4.3, §7) — web routes and the service
 * functions the servers module uses (default policy on registration, plugin policy DTO).
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import { registerPolicyRoutes } from './routes';

export {
  getActivePolicy,
  materializeDefaultPolicy,
  savePolicy,
  savePolicyTx,
  toServerPolicyDto,
  toServerPolicyView,
  toWireRule,
  type PolicyWithRules,
  type SavePolicyContext,
} from './service';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  await registerPolicyRoutes(app, deps);
}
