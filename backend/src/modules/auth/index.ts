/**
 * auth module entry point (registered under /api/v1 by src/modules/index.ts).
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import { registerAuthRoutes } from './routes';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  await registerAuthRoutes(app, deps);
}
