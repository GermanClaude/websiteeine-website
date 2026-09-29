import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AuditChainVectors, PolicyVectors, ProofCodeVectors, SigningVectors } from '../../scripts/vectors/types';

const VECTOR_DIR = join(dirname(fileURLToPath(import.meta.url)), '../../test-vectors');

function load<T>(file: string): T {
  return JSON.parse(readFileSync(join(VECTOR_DIR, file), 'utf8')) as T;
}

export const loadSigningVectors = (): SigningVectors => load<SigningVectors>('signing.json');
export const loadProofVectors = (): ProofCodeVectors => load<ProofCodeVectors>('proof-codes.json');
export const loadPolicyVectors = (): PolicyVectors => load<PolicyVectors>('policy.json');
export const loadAuditVectors = (): AuditChainVectors => load<AuditChainVectors>('audit-chain.json');
