/**
 * dashboard module (§13 "Dashboard").
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import { registerDashboardRoutes } from './routes';
import { DashboardService } from './service';

export { DashboardService } from './service';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new DashboardService(deps);
  await registerDashboardRoutes(app, deps, service);
}
