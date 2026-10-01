/**
 * Signal catalogue for the intrusion-detection observer.
 *
 * Each signal has a weight (added to the source's decaying risk score) and a severity. The
 * score crossing BLOCK_THRESHOLD within the window triggers a transient block. Heuristic
 * request-metadata signals (injection probes, scanner user-agents) are deliberately LOW
 * weight: a single heuristic hit can never block a source on its own.
 */
import type { SecurityEventKind, SecuritySeverity } from '@scpsl-trust/shared';

export interface SignalDef {
  readonly weight: number;
  readonly severity: SecuritySeverity;
}

/** Signal kinds (the subset of SecurityEventKind that are detector inputs, not outcomes). */
export type SignalKind = Extract<
  SecurityEventKind,
  | 'auth_failure_burst'
  | 'request_burst'
  | 'invalid_signature'
  | 'replayed_nonce'
  | 'duplicate_request_id'
  | 'csrf_failure'
  | 'malformed_auth'
  | 'injection_probe'
  | 'scanner_user_agent'
>;

export const SIGNAL_DEFS: Readonly<Record<SignalKind, SignalDef>> = Object.freeze({
  replayed_nonce: { weight: 40, severity: 'high' },
  invalid_signature: { weight: 25, severity: 'medium' },
  auth_failure_burst: { weight: 25, severity: 'medium' },
  request_burst: { weight: 20, severity: 'medium' },
  csrf_failure: { weight: 20, severity: 'medium' },
  duplicate_request_id: { weight: 15, severity: 'low' },
  malformed_auth: { weight: 10, severity: 'low' },
  // Heuristic metadata matches — intentionally low weight (never block on one hit).
  injection_probe: { weight: 8, severity: 'low' },
  scanner_user_agent: { weight: 5, severity: 'low' },
});

/** AppError codes mapped to the signal they contribute (recorded in the onError hook). */
export const ERROR_CODE_SIGNALS: Readonly<Record<string, SignalKind>> = Object.freeze({
  INVALID_SIGNATURE: 'invalid_signature',
  REPLAYED_NONCE: 'replayed_nonce',
  DUPLICATE_REQUEST_ID: 'duplicate_request_id',
  CSRF_TOKEN_INVALID: 'csrf_failure',
  MISSING_AUTH_HEADERS: 'malformed_auth',
  INVALID_AUTH_HEADERS: 'malformed_auth',
  TIMESTAMP_OUT_OF_RANGE: 'malformed_auth',
  INVALID_CREDENTIALS: 'auth_failure_burst',
  INVALID_MFA_CODE: 'auth_failure_burst',
});

// ---------------------------------------------------------------------------
// Conservative request-metadata heuristics (bounded cost, metadata only)
// ---------------------------------------------------------------------------

const MAX_SCAN_LENGTH = 2048;
const MAX_UA_LENGTH = 512;

/** SQL-injection, path-traversal and reflected-script probes (conservative, few false positives). */
const PROBE_PATTERNS: readonly RegExp[] = Object.freeze([
  /\bunion\b[\s/*]+\bselect\b/i,
  /\bor\b\s+1\s*=\s*1\b/i,
  /;\s*drop\s+table\b/i,
  /'\s*(or|and)\s+'?\d/i,
  /\.\.[/\\]/,
  /%2e%2e[/\\%]/i,
  /<script\b/i,
  /<svg[^>]*\bonload\b/i,
  /\bjavascript:/i,
]);

/** Well-known offensive scanners/exploitation tools (NOT generic clients like curl). */
const SCANNER_UA_PATTERN =
  /\b(sqlmap|nikto|nmap|masscan|acunetix|nessus|dirbuster|gobuster|wpscan|zgrab|hydra|nuclei|arachni)\b/i;

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export interface MetadataScanResult {
  readonly probe: boolean;
  readonly scanner: boolean;
}

/**
 * Scans request metadata only (target URL + user-agent), with a hard cost cap. Never reads
 * the body. Returns which heuristic categories matched.
 */
export function scanRequestMetadata(rawUrl: string, userAgent: string | undefined): MetadataScanResult {
  const url = rawUrl.slice(0, MAX_SCAN_LENGTH);
  const decoded = safeDecode(url).slice(0, MAX_SCAN_LENGTH);
  const probe = PROBE_PATTERNS.some((pattern) => pattern.test(url) || pattern.test(decoded));
  const ua = (userAgent ?? '').slice(0, MAX_UA_LENGTH);
  const scanner = ua.length > 0 && SCANNER_UA_PATTERN.test(ua);
  return { probe, scanner };
}
