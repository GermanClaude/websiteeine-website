/**
 * reports module entry point (registered under /api/v1 by src/modules/index.ts).
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import { registerReportPluginRoutes } from './plugin-routes';
import { registerReportRoutes } from './routes';
import { ReportsService } from './service';

export { ReportsService } from './service';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new ReportsService(deps);
  await registerReportRoutes(app, deps, service);
  await registerReportPluginRoutes(app, deps, service);
}
