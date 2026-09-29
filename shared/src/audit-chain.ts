/**
 * Audit hash-chain helpers (ARCHITECTURE §9.1). Pure: the caller computes
 *   hash = sha256_hex(auditHashInput(event, prevHash))
 * with its platform crypto (UTF-8 bytes of the returned string).
 */
import { canonicalJson } from './canonical-json';
import type { ActorType, AuditAction } from './enums';

/** prev_hash of the first event in the chain (64 × "0"). */
export const AUDIT_GENESIS_PREV_HASH = '0'.repeat(64);

/** pg_advisory_xact_lock key serializing audit writes. */
export const AUDIT_ADVISORY_LOCK_KEY = 7274001;

/** Exactly the fields covered by the hash (`event_without_hashes`). */
export const AUDIT_HASHED_FIELDS = Object.freeze([
  'seq',
  'event_id',
  'created_at',
  'actor_type',
  'actor_id',
  'action',
  'target_type',
  'target_id',
  'server_id',
  'case_id',
  'metadata',
  'request_id',
] as const);

export interface AuditHashableEvent {
  seq: number;
  event_id: string;
  /** ISO-8601 UTC with milliseconds. */
  created_at: string;
  actor_type: ActorType;
  actor_id: string | null;
  action: AuditAction;
  target_type: string;
  target_id: string | null;
  /** servers.id (uuid) the event relates to. */
  server_id: string | null;
  /** cases.id (uuid) the event relates to. */
  case_id: string | null;
  metadata: Record<string, unknown>;
  request_id: string | null;
}

export interface AuditHashableEventInput {
  seq: number;
  event_id: string;
  created_at: string | Date;
  actor_type: ActorType;
  actor_id?: string | null;
  action: AuditAction;
  target_type: string;
  target_id?: string | null;
  server_id?: string | null;
  case_id?: string | null;
  metadata?: Record<string, unknown> | null;
  request_id?: string | null;
}

/**
 * Normalizes an event to the hashed shape: absent optional fields → null, Date → ISO string,
 * metadata defaults to {}. Extra properties (hash, prev_hash, …) are dropped.
 */
export function toAuditHashableEvent(event: AuditHashableEventInput): AuditHashableEvent {
  if (!Number.isSafeInteger(event.seq) || event.seq < 1) throw new TypeError('Audit seq must be a positive integer');
  const createdAt = event.created_at instanceof Date ? event.created_at.toISOString() : event.created_at;
  return {
    seq: event.seq,
    event_id: event.event_id,
    created_at: createdAt,
    actor_type: event.actor_type,
    actor_id: event.actor_id ?? null,
    action: event.action,
    target_type: event.target_type,
    target_id: event.target_id ?? null,
    server_id: event.server_id ?? null,
    case_id: event.case_id ?? null,
    metadata: event.metadata ?? {},
    request_id: event.request_id ?? null,
  };
}

/** canonical_json(event_without_hashes) + prev_hash — the SHA-256 input string. */
export function auditHashInput(event: AuditHashableEventInput, prevHash: string): string {
  if (!/^[0-9a-f]{64}$/.test(prevHash)) throw new TypeError('prevHash must be 64 lowercase hex characters');
  return canonicalJson(toAuditHashableEvent(event)) + prevHash;
}
