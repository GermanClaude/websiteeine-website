import { describe, expect, it } from 'vitest';
import {
  buildErrorResponse,
  ERROR_CODES,
  ERROR_DEFINITIONS,
  ErrorCode,
  ErrorCodeSchema,
  errorMessage,
  ErrorResponseSchema,
  errorStatus,
  formatCaseNumber,
  formatReviewerPseudonym,
  isCaseNumber,
  isErrorCode,
  LINK_CODE_REGEX,
  parseCaseNumber,
  REGISTRATION_TOKEN_REGEX,
  USERNAME_REGEX,
} from '../src';

describe('error catalogue', () => {
  it('maps every §14.1 code to its status', () => {
    const expected: Record<string, number> = {
      VALIDATION_FAILED: 400,
      INVALID_AUTH_HEADERS: 400,
      SERVER_ID_MISMATCH: 400,
      UNAUTHENTICATED: 401,
      INVALID_CREDENTIALS: 401,
      MISSING_AUTH_HEADERS: 401,
      INVALID_SIGNATURE: 401,
      TIMESTAMP_OUT_OF_RANGE: 401,
      REPLAYED_NONCE: 401,
      UNKNOWN_SERVER: 401,
      KEY_REVOKED: 401,
      NO_ACTIVE_KEY: 401,
      INVALID_MFA_CODE: 401,
      MFA_TOKEN_INVALID: 401,
      FORBIDDEN: 403,
      CSRF_TOKEN_INVALID: 403,
      EMAIL_NOT_VERIFIED: 403,
      ACCOUNT_LOCKED: 423,
      ACCOUNT_DISABLED: 403,
      MFA_ENROLLMENT_REQUIRED: 403,
      SERVER_SUSPENDED: 403,
      SERVER_REVOKED: 403,
      NOT_FOUND: 404,
      CONFLICT: 409,
      DUPLICATE_REQUEST_ID: 409,
      CONFLICT_OF_INTEREST: 409,
      ALREADY_EXISTS: 409,
      INVALID_STATE: 409,
      REGISTRATION_TOKEN_INVALID: 400,
      PROOF_OF_POSSESSION_INVALID: 400,
      PAYLOAD_TOO_LARGE: 413,
      UNSUPPORTED_MEDIA_TYPE: 415,
      INSUFFICIENT_EVIDENCE: 422,
      RATE_LIMITED: 429,
      INTERNAL_ERROR: 500,
      SERVICE_UNAVAILABLE: 503,
    };
    for (const [code, status] of Object.entries(expected)) {
      expect(isErrorCode(code), code).toBe(true);
      expect(errorStatus(code as ErrorCode), code).toBe(status);
    }
    expect(ERROR_DEFINITIONS.INVALID_SIGNATURE.message).toBe('Request signature is invalid');
  });

  it('includes the additional codes and valid statuses', () => {
    for (const code of [
      'PASSWORD_TOO_WEAK',
      'REGISTRATION_DISABLED',
      'PLAYER_NOT_LINKED',
      'PLAYER_ALREADY_LINKED',
      'LINK_CODE_INVALID',
      'MFA_ALREADY_ENABLED',
      'MFA_NOT_ENABLED',
      'EVIDENCE_INTEGRITY_FAILED',
      'STORAGE_ERROR',
      'INVALID_TIMESTAMP',
      'SERVER_NOT_ACTIVE',
      'WHITELIST_REQUESTS_DISABLED',
      'APPEAL_NOT_ALLOWED',
      'INVALID_VERDICT_TRANSITION',
    ]) {
      expect(isErrorCode(code), code).toBe(true);
    }
    for (const code of ERROR_CODES) {
      expect(code).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(errorStatus(code)).toBeGreaterThanOrEqual(400);
      expect(errorStatus(code)).toBeLessThan(600);
      expect(errorMessage(code).length).toBeGreaterThan(0);
      expect(ErrorCode[code]).toBe(code);
    }
  });

  it('isErrorCode rejects unknown and prototype keys', () => {
    expect(isErrorCode('NOPE')).toBe(false);
    expect(isErrorCode('toString')).toBe(false);
    expect(isErrorCode('__proto__')).toBe(false);
    expect(isErrorCode(401)).toBe(false);
    expect(ErrorCodeSchema.safeParse('invalid_signature').success).toBe(false);
  });

  it('builds the canonical error body', () => {
    const body = buildErrorResponse('VALIDATION_FAILED', 'req-1', { details: [{ path: 'player.id', message: 'bad' }] });
    expect(body).toEqual({
      error: {
        code: 'VALIDATION_FAILED',
        message: 'Request validation failed',
        details: [{ path: 'player.id', message: 'bad' }],
        request_id: 'req-1',
      },
    });
    expect(ErrorResponseSchema.parse(body)).toEqual(body);
    const plain = buildErrorResponse('NOT_FOUND', 'req-2', { message: 'Case not found' });
    expect(plain.error).not.toHaveProperty('details');
    expect(plain.error.message).toBe('Case not found');
  });

  it('error schema strips unexpected fields such as stack traces', () => {
    const parsed = ErrorResponseSchema.parse({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', request_id: 'r', stack: 'Error: at …' },
    });
    expect(parsed.error).not.toHaveProperty('stack');
    expect(ErrorResponseSchema.safeParse({ error: { code: 'X', message: 'm' } }).success).toBe(false);
  });
});

describe('formats', () => {
  it('case numbers', () => {
    expect(formatCaseNumber(2026, 1337)).toBe('CASE-2026-001337');
    expect(formatCaseNumber(2026, 999999)).toBe('CASE-2026-999999');
    expect(parseCaseNumber('CASE-2026-001337')).toEqual({ year: 2026, counter: 1337 });
    for (const bad of ['CASE-2026-000000', 'CASE-26-001337', 'case-2026-001337', 'CASE-2026-1337', 'CASE-2026-0013370', 'CASE-2026-001337 ']) {
      expect(parseCaseNumber(bad), bad).toBeNull();
      expect(isCaseNumber(bad)).toBe(false);
    }
    expect(() => formatCaseNumber(2026, 0)).toThrow(RangeError);
    expect(() => formatCaseNumber(2026, 1_000_000)).toThrow(RangeError);
    expect(() => formatCaseNumber(26, 1)).toThrow(RangeError);
  });

  it('reviewer pseudonym', () => {
    expect(formatReviewerPseudonym(184)).toBe('Reviewer #184');
    expect(() => formatReviewerPseudonym(0)).toThrow(RangeError);
    expect(() => formatReviewerPseudonym(1.5)).toThrow(RangeError);
  });

  it('identifier regexes', () => {
    expect('LNK-7K4X92').toMatch(LINK_CODE_REGEX);
    expect('LNK-7K4X9U').not.toMatch(LINK_CODE_REGEX);
    expect('lnk-7k4x92').not.toMatch(LINK_CODE_REGEX);
    expect(`sreg_${'A'.repeat(43)}`).toMatch(REGISTRATION_TOKEN_REGEX);
    expect(`sreg_${'A'.repeat(42)}`).not.toMatch(REGISTRATION_TOKEN_REGEX);
    expect(`sreg_${'A'.repeat(42)}=`).not.toMatch(REGISTRATION_TOKEN_REGEX);
    expect('user.name-1_x').toMatch(USERNAME_REGEX);
    for (const bad of ['ab', 'a'.repeat(33), 'with space', 'emoji\u{1F600}', 'semi;colon']) {
      expect(bad).not.toMatch(USERNAME_REGEX);
    }
  });
});
