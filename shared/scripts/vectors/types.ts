/**
 * JSON shapes of shared/test-vectors/*.json (documented in test-vectors/README.md).
 */
import type { PolicyDecision, PolicyEvaluationInput } from '../../src/schemas/policy';
import type { AuditHashableEvent } from '../../src/audit-chain';

// ---------------------------------------------------------------------------
// signing.json
// ---------------------------------------------------------------------------

export interface KeyVector {
  /** TEST ONLY — 32-byte Ed25519 seed (private key). */
  seed_hex: string;
  public_key_hex: string;
  /** base64 (standard, padded) of the 32 raw public-key bytes. */
  public_key_b64: string;
  fingerprint: string;
}

export interface SignedRequestInputs {
  method: string;
  path_with_query: string;
  server_id: string;
  /** X-Timestamp header value (unix ms, decimal string). */
  timestamp: string;
  nonce: string;
  request_id: string;
  /** Raw body as UTF-8 text ('' = no body). */
  body: string;
  /** Exact body bytes (base64) — identical to UTF-8(body). */
  body_base64: string;
  body_sha256_hex: string;
}

export interface SigningRequestVector extends SignedRequestInputs {
  name: string;
  description: string;
  canonical: string;
  signature_b64: string;
  /** Headers exactly as the plugin sends them. */
  headers: Record<string, string>;
}

export interface SigningNegativeVector extends SignedRequestInputs {
  name: string;
  description: string;
  based_on: string;
  /** Canonical string of THIS (tampered) request. */
  canonical: string;
  /** Signature that must NOT verify against `canonical` with `public_key_b64`. */
  signature_b64: string;
  public_key_b64: string;
  expected_valid: false;
}

export interface RegistrationPopVector {
  registration_token: string;
  public_key_b64: string;
  timestamp: number;
  message: string;
  signature_b64: string;
  request_body: Record<string, unknown>;
}

export interface RotationPopVector {
  server_id: string;
  current_key_fingerprint: string;
  new_public_key_b64: string;
  new_key_fingerprint: string;
  timestamp: number;
  message: string;
  /** Signed by the NEW key. */
  signature_b64: string;
  request_body: Record<string, unknown>;
}

export interface PopNegativeVector {
  name: string;
  description: string;
  message: string;
  signature_b64: string;
  public_key_b64: string;
  expected_valid: false;
}

export interface SigningVectors {
  version: string;
  description: string;
  rfc8032_test_1: { seed_hex: string; public_key_hex: string; message_hex: string; signature_hex: string };
  key: KeyVector;
  rotation_key: KeyVector;
  requests: SigningRequestVector[];
  negative: SigningNegativeVector[];
  registration_pop: RegistrationPopVector;
  rotation_pop: RotationPopVector;
  pop_negative: PopNegativeVector[];
}

// ---------------------------------------------------------------------------
// proof-codes.json
// ---------------------------------------------------------------------------

export interface ProofCodeVector {
  name: string;
  secret_b64: string;
  secret_hex: string;
  session_id: string;
  server_id: string;
  target_user_id: string;
  spectator_user_id: string;
  unix_seconds: number;
  interval_seconds: number;
  window: number;
  message: string;
  mac_hex: string;
  code: string;
}

export interface ProofCodeVectors {
  version: string;
  description: string;
  alphabet: string;
  cases: ProofCodeVector[];
}

// ---------------------------------------------------------------------------
// policy.json
// ---------------------------------------------------------------------------

export interface PolicyVectorExpected {
  action: PolicyDecision['action'];
  applied_rule_ids: string[];
  bypassed_rule_ids: string[];
  notify_admins: boolean;
  message: string | null;
  ban_duration_minutes: number | null;
}

export interface PolicyVectorCase {
  name: string;
  description: string;
  /** false when the policy intentionally contains rules unknown to this version. */
  schema_valid: boolean;
  policy: {
    version: number;
    backend_unavailable_action: string;
    notify_on_enforcement: boolean;
    honor_global_bypasses: boolean;
    whitelist_url: string | null;
    rules: Array<Record<string, unknown>>;
  };
  input: PolicyEvaluationInput;
  context: { server_name?: string };
  expected: PolicyVectorExpected;
  /** Full decision including reason codes (applied/bypassed outcomes). */
  expected_decision: PolicyDecision;
}

export interface PolicyVectors {
  version: string;
  description: string;
  cases: PolicyVectorCase[];
}

// ---------------------------------------------------------------------------
// audit-chain.json
// ---------------------------------------------------------------------------

export interface AuditChainEventVector {
  event_without_hashes: AuditHashableEvent;
  canonical_json: string;
  prev_hash: string;
  hash: string;
}

export interface CanonicalJsonExample {
  name: string;
  input: unknown;
  canonical_json: string;
}

export interface AuditChainVectors {
  version: string;
  description: string;
  genesis_prev_hash: string;
  events: AuditChainEventVector[];
  canonical_json_examples: CanonicalJsonExample[];
}
