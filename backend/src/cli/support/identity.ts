/**
 * Test identities in the plugin's identity.json format
 * ({ server_id, private_key_seed_b64, public_key_b64, fingerprint, created_at }).
 */
import { SERVER_ID_REGEX } from '@scpsl-trust/shared';

import { generateEd25519KeyPair, keyFingerprint } from '../../lib/crypto';

export interface IdentityFile {
  server_id: string | null;
  private_key_seed_b64: string;
  public_key_b64: string;
  fingerprint: string;
  created_at: string;
}

export function generateIdentity(serverId: string | null, now: Date = new Date()): IdentityFile {
  if (serverId !== null && !SERVER_ID_REGEX.test(serverId)) throw new Error('Invalid server id');
  const pair = generateEd25519KeyPair();
  return {
    server_id: serverId,
    private_key_seed_b64: Buffer.from(pair.seedHex, 'hex').toString('base64'),
    public_key_b64: pair.publicKeyB64,
    fingerprint: keyFingerprint(pair.publicKeyB64),
    created_at: now.toISOString(),
  };
}
