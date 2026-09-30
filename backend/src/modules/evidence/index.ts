/**
 * evidence module entry point (registered under /api/v1 by src/modules/index.ts).
 * @fastify/multipart is registered here, inside this module's encapsulated scope, so
 * multipart parsing exists only for the evidence upload routes.
 */
import multipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import { registerEvidenceRoutes } from './routes';
import { EvidenceService } from './service';

export { EvidenceService } from './service';

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  await app.register(multipart, {
    limits: {
      files: 1,
      // One byte above the evidence limit: storage.put() then fails with a clean 413
      // instead of busboy silently truncating the stream.
      fileSize: deps.config.evidence.maxBytes + 1,
      fields: 10,
      fieldSize: 10_000,
      parts: 12,
    },
  });
  const service = new EvidenceService(deps);
  await registerEvidenceRoutes(app, deps, service);
}
