/**
 * users module entry point (registered under /api/v1 by src/modules/index.ts).
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import { registerUserPluginRoutes } from './plugin-routes';
import { registerUserRoutes } from './routes';
import { UsersService } from './service';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = new UsersService(deps);
  await registerUserRoutes(app, deps, service);
  await registerUserPluginRoutes(app, deps, service);
}
