/**
 * appeals module (§11.5): appeal lifecycle with independent decisions.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import { registerAppealRoutes } from './routes';
import { AppealsService } from './service';

export { AppealsService, toAppealView } from './service';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new AppealsService(deps);
  await registerAppealRoutes(app, deps, service);
}
