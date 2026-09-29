/**
 * players module entry point (registered under /api/v1 by src/modules/index.ts).
 * Optionally export `registerJobs(scheduler, deps)` to add background jobs.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';

export default async function register(_app: FastifyInstance, _deps: Deps): Promise<void> {
  // implemented by the players module
}
