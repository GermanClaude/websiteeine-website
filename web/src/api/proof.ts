/**
 * Overwatch proof verification — `GET /evidence/proof` (ARCHITECTURE §10.3). Optional auth:
 * anonymous callers must supply a code; callers with proof:view_code also receive the
 * expected code. A valid proof establishes session identity only, never guilt (R6).
 */
import { ProofResponseSchema, type ProofQuery, type ProofResponse } from '@scpsl-trust/shared';

import { api } from './client';

/** Parsed `ProofQuery` (timestamp already converted to epoch milliseconds by the shared schema). */
export function verifyProof(query: ProofQuery, signal?: AbortSignal): Promise<ProofResponse> {
  return api.get<ProofResponse>('/evidence/proof', {
    query: {
      server_id: query.server_id,
      player_id: query.player_id,
      spectator_id: query.spectator_id,
      timestamp: String(query.timestamp),
      code: query.code,
      session_id: query.session_id,
    },
    schema: ProofResponseSchema,
    signal,
  });
}
