/**
 * Error code catalogue and HTTP status mapping (ARCHITECTURE §2.1, §14.1).
 * Error body: { error: { code, message, details?, request_id } } — never stack traces.
 */
import { z } from 'zod';

interface ErrorDefinition {
  readonly status: number;
  readonly message: string;
}

export const ERROR_DEFINITIONS = {
  // 400 — malformed or invalid input
  VALIDATION_FAILED: { status: 400, message: 'Request validation failed' },
  BAD_REQUEST: { status: 400, message: 'Malformed request' },
  INVALID_AUTH_HEADERS: { status: 400, message: 'Authentication headers are malformed' },
  SERVER_ID_MISMATCH: { status: 400, message: 'Body server_id does not match the authenticated server' },
  REGISTRATION_TOKEN_INVALID: { status: 400, message: 'Registration token is invalid, expired or already used' },
  PROOF_OF_POSSESSION_INVALID: { status: 400, message: 'Proof of possession is invalid' },
  INVALID_PUBLIC_KEY: { status: 400, message: 'Public key is not a valid Ed25519 key' },
  INVALID_TIMESTAMP: { status: 400, message: 'Timestamp is invalid or outside the allowed range' },
  PASSWORD_TOO_WEAK: { status: 400, message: 'Password does not meet the password requirements' },
  PASSWORD_INCORRECT: { status: 400, message: 'Current password is incorrect' },
  TOKEN_INVALID: { status: 400, message: 'Token is invalid or expired' },
  LINK_CODE_INVALID: { status: 400, message: 'Link code is invalid or expired' },

  // 401 — authentication
  UNAUTHENTICATED: { status: 401, message: 'Authentication required' },
  INVALID_CREDENTIALS: { status: 401, message: 'Invalid email or password' },
  MISSING_AUTH_HEADERS: { status: 401, message: 'Required authentication headers are missing' },
  INVALID_SIGNATURE: { status: 401, message: 'Request signature is invalid' },
  TIMESTAMP_OUT_OF_RANGE: { status: 401, message: 'Request timestamp is outside the allowed clock skew' },
  REPLAYED_NONCE: { status: 401, message: 'Nonce has already been used' },
  UNKNOWN_SERVER: { status: 401, message: 'Unknown server' },
  KEY_REVOKED: { status: 401, message: 'Signing key has been revoked' },
  NO_ACTIVE_KEY: { status: 401, message: 'Server has no active signing key' },
  INVALID_MFA_CODE: { status: 401, message: 'Invalid two-factor authentication code' },
  MFA_TOKEN_INVALID: { status: 401, message: 'Two-factor login token is invalid or expired' },

  // 403 — authorization / state of the caller
  FORBIDDEN: { status: 403, message: 'You do not have permission to perform this action' },
  CSRF_TOKEN_INVALID: { status: 403, message: 'CSRF token is missing or invalid' },
  EMAIL_NOT_VERIFIED: { status: 403, message: 'Email address has not been verified' },
  ACCOUNT_DISABLED: { status: 403, message: 'Account is disabled' },
  MFA_ENROLLMENT_REQUIRED: { status: 403, message: 'Two-factor authentication must be enabled for this role' },
  SERVER_SUSPENDED: { status: 403, message: 'Server is suspended' },
  SERVER_REVOKED: { status: 403, message: 'Server has been revoked' },
  REGISTRATION_DISABLED: { status: 403, message: 'Registration is disabled' },
  PLAYER_NOT_LINKED: { status: 403, message: 'A linked in-game identity is required' },
  WHITELIST_REQUESTS_DISABLED: { status: 403, message: 'This server does not accept whitelist requests' },

  // 404
  NOT_FOUND: { status: 404, message: 'Resource not found' },

  // 409 — conflicts and invalid state transitions
  CONFLICT: { status: 409, message: 'Request conflicts with the current state' },
  DUPLICATE_REQUEST_ID: { status: 409, message: 'Request id has already been used' },
  CONFLICT_OF_INTEREST: { status: 409, message: 'You cannot decide on a case you are involved in' },
  ALREADY_EXISTS: { status: 409, message: 'Resource already exists' },
  INVALID_STATE: { status: 409, message: 'Operation is not allowed in the current state' },
  PUBLIC_KEY_IN_USE: { status: 409, message: 'Public key is already registered' },
  PLAYER_ALREADY_LINKED: { status: 409, message: 'In-game identity is already linked to an account' },
  MFA_ALREADY_ENABLED: { status: 409, message: 'Two-factor authentication is already enabled' },
  MFA_NOT_ENABLED: { status: 409, message: 'Two-factor authentication is not enabled' },
  MFA_SETUP_NOT_STARTED: { status: 409, message: 'Two-factor setup has not been started' },
  SERVER_NOT_ACTIVE: { status: 409, message: 'Server is not active' },
  APPEAL_NOT_ALLOWED: { status: 409, message: 'An appeal is not possible for this case' },
  INVALID_VERDICT_TRANSITION: { status: 409, message: 'Verdict transition is not allowed' },
  OPEN_REPORT_EXISTS: { status: 409, message: 'You already have an open report for this player' },
  EVIDENCE_ALREADY_SUPERSEDED: { status: 409, message: 'Evidence has already been superseded' },
  EVIDENCE_INTEGRITY_FAILED: { status: 409, message: 'Stored evidence does not match its recorded hash' },
  CANNOT_REMOVE_OWNER: { status: 409, message: 'The server owner cannot be removed' },

  // 413 / 415 / 422 / 423 / 429
  PAYLOAD_TOO_LARGE: { status: 413, message: 'Payload too large' },
  UNSUPPORTED_MEDIA_TYPE: { status: 415, message: 'Unsupported media type' },
  INSUFFICIENT_EVIDENCE: { status: 422, message: 'A confirmed verdict requires verified authentic evidence of cheating' },
  ACCOUNT_LOCKED: { status: 423, message: 'Account is temporarily locked' },
  RATE_LIMITED: { status: 429, message: 'Too many requests' },

  // 5xx
  INTERNAL_ERROR: { status: 500, message: 'Internal server error' },
  STORAGE_ERROR: { status: 502, message: 'Evidence storage is unavailable' },
  SERVICE_UNAVAILABLE: { status: 503, message: 'Service temporarily unavailable' },
} as const satisfies Record<string, ErrorDefinition>;

export type ErrorCode = keyof typeof ERROR_DEFINITIONS;

export const ERROR_CODES = Object.freeze(Object.keys(ERROR_DEFINITIONS)) as unknown as [ErrorCode, ...ErrorCode[]];

/** Named constants: ErrorCode.INVALID_SIGNATURE === 'INVALID_SIGNATURE'. */
export const ErrorCode = Object.freeze(
  Object.fromEntries(ERROR_CODES.map((code) => [code, code])) as { readonly [K in ErrorCode]: K },
);

export const ErrorCodeSchema = z.enum(ERROR_CODES);

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_DEFINITIONS, value);
}

/** HTTP status of an error code. */
export function errorStatus(code: ErrorCode): number {
  return ERROR_DEFINITIONS[code].status;
}

/** Default (generic, client-safe) message of an error code. */
export function errorMessage(code: ErrorCode): string {
  return ERROR_DEFINITIONS[code].message;
}

/** One validation issue in `details` (e.g. { path: "player.id", message: "…" }). */
export const ValidationIssueSchema = z.object({
  path: z.string(),
  message: z.string(),
});
export type ValidationIssue = z.infer<typeof ValidationIssueSchema>;

export const ErrorDetailsSchema = z.union([z.array(ValidationIssueSchema), z.record(z.string(), z.unknown())]);
export type ErrorDetails = z.infer<typeof ErrorDetailsSchema>;

export const ErrorBodySchema = z.object({
  // Plain string so clients stay tolerant of codes added by newer backends.
  code: z.string().min(1).max(64),
  message: z.string().max(1000),
  details: ErrorDetailsSchema.optional(),
  request_id: z.string().max(128),
});
export type ErrorBody = z.infer<typeof ErrorBodySchema>;

export const ErrorResponseSchema = z.object({ error: ErrorBodySchema });
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

/** Builds the canonical error body; the message defaults to the catalogue text. */
export function buildErrorResponse(
  code: ErrorCode,
  requestId: string,
  options: { message?: string; details?: ErrorDetails } = {},
): ErrorResponse {
  const error: ErrorBody = {
    code,
    message: options.message ?? errorMessage(code),
    request_id: requestId,
  };
  if (options.details !== undefined) error.details = options.details;
  return { error };
}
