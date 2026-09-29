/**
 * Common zod building blocks shared by every module schema.
 *
 * Conventions:
 *  - Request schemas use z.object (unknown keys stripped) and may transform (trim, '' → null).
 *  - Response schemas never contain transforms: the backend serializer runs z.encode, which
 *    rejects unidirectional transforms.
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { PlayerIdTypeSchema } from '../enums';
import { CASE_NUMBER_REGEX, USERNAME_REGEX } from '../formats';
import { isCanonicalUserId, isValidPlayerId, USER_ID_MAX_LENGTH } from '../identity';
import {
  KEY_FINGERPRINT_REGEX,
  NONCE_REGEX,
  PLUGIN_VERSION_REGEX,
  PUBLIC_KEY_B64_REGEX,
  REQUEST_ID_REGEX,
  SERVER_ID_REGEX,
  SIGNATURE_B64_REGEX,
} from '../signing';

export { ErrorResponseSchema, type ErrorResponse } from '../errors';

// ---------------------------------------------------------------------------
// Scalars
// ---------------------------------------------------------------------------

export const UuidSchema = z.uuid();
/** ISO-8601 date-time string (Z or offset; responses always use `toISOString()` form). */
export const IsoDateTimeSchema = z.iso.datetime({ offset: true });
export const ServerIdSchema = z.string().regex(SERVER_ID_REGEX, 'Invalid server id');
export const CaseNumberSchema = z.string().regex(CASE_NUMBER_REGEX, 'Invalid case number');
export const KeyFingerprintSchema = z.string().regex(KEY_FINGERPRINT_REGEX, 'Invalid key fingerprint');
export const PublicKeyB64Schema = z
  .string()
  .regex(PUBLIC_KEY_B64_REGEX, 'Public key must be canonical base64 of 32 bytes');
export const SignatureB64Schema = z
  .string()
  .regex(SIGNATURE_B64_REGEX, 'Signature must be canonical base64 of 64 bytes');
export const NonceSchema = z.string().regex(NONCE_REGEX, 'Invalid nonce');
export const RequestIdSchema = z.string().regex(REQUEST_ID_REGEX, 'Request id must be a UUID v4');
export const PluginVersionSchema = z
  .string()
  .max(LIMITS.PLUGIN_VERSION_MAX)
  .regex(PLUGIN_VERSION_REGEX, 'Plugin version must be a semantic version');
export const GameVersionSchema = z.string().trim().min(1).max(LIMITS.GAME_VERSION_MAX);
export const UsernameSchema = z.string().regex(USERNAME_REGEX, 'Username must be 3–32 characters [A-Za-z0-9_.-]');
/** Unix epoch milliseconds (JSON number). */
export const EpochMsSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const IpAddressSchema = z.union([z.ipv4(), z.ipv6()]);
export const Sha256HexSchema = z.string().regex(/^[0-9a-f]{64}$/, 'Invalid SHA-256 hex digest');
/** Email for requests: trimmed and lower-cased before validation. */
export const EmailInputSchema = z.string().trim().toLowerCase().max(LIMITS.EMAIL_MAX).pipe(z.email());
/** Email in responses (no transforms). */
export const EmailSchema = z.email().max(LIMITS.EMAIL_MAX);
export const HttpsUrlSchema = z
  .url({ protocol: /^https$/ })
  .max(LIMITS.URL_MAX)
  .refine((value) => value.toLowerCase().startsWith('https://'), 'URL must use https://');
export const HttpUrlSchema = z
  .url({ protocol: /^https?$/ })
  .max(LIMITS.URL_MAX)
  .refine((value) => /^https?:\/\//i.test(value), 'URL must use http:// or https://');

/** Required, trimmed text for requests. */
export function requiredText(min: number, max: number) {
  return z.string().trim().min(min).max(max);
}

/** Optional text for requests: absent, null and '' (after trim) all become null. */
export function optionalText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value): string | null => (value === undefined || value === null || value === '' ? null : value));
}

/**
 * Text field of a PATCH body: absent stays undefined (= unchanged); null and '' become null
 * (= clear); other values are trimmed.
 */
export function patchText(max: number) {
  return z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((value): string | null | undefined => (value === '' ? null : value));
}

// ---------------------------------------------------------------------------
// Player identity
// ---------------------------------------------------------------------------

/** `{ type, id }` with per-type id validation (§2.2). */
export const PlayerRefSchema = z
  .object({
    type: PlayerIdTypeSchema,
    id: z.string().min(1).max(64),
  })
  .refine((ref) => isValidPlayerId(ref.type, ref.id), { message: 'Invalid player id for its type', path: ['id'] });

/** Canonical `<id>@<type>` string (no URL encoding). */
export const UserIdStringSchema = z
  .string()
  .min(3)
  .max(USER_ID_MAX_LENGTH)
  .refine((value) => isCanonicalUserId(value), 'Invalid player user id (expected <id>@<type>)');

// ---------------------------------------------------------------------------
// Lightweight references used inside views
// ---------------------------------------------------------------------------

export const PlayerSummarySchema = z.object({
  user_id: UserIdStringSchema,
  type: PlayerIdTypeSchema,
  id: z.string(),
  display_name: z.string().nullable(),
});
export type PlayerSummary = z.infer<typeof PlayerSummarySchema>;

export const UserRefSchema = z.object({
  id: UuidSchema,
  username: z.string(),
});
export type UserRef = z.infer<typeof UserRefSchema>;

export const ServerRefSchema = z.object({
  server_id: ServerIdSchema,
  name: z.string(),
  is_trusted: z.boolean(),
});
export type ServerRef = z.infer<typeof ServerRefSchema>;

/** Reviewer shown by pseudonym only (`Reviewer #184`). */
export const ReviewerRefSchema = z.object({
  reviewer_number: z.number().int().positive().nullable(),
  pseudonym: z.string(),
});
export type ReviewerRef = z.infer<typeof ReviewerRefSchema>;

// ---------------------------------------------------------------------------
// Pagination & generic responses
// ---------------------------------------------------------------------------

export const paginationQueryShape = {
  page: z.coerce.number().int().min(1).max(LIMITS.PAGE_MAX).default(1),
  page_size: z.coerce.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX).default(LIMITS.PAGE_SIZE_DEFAULT),
};

/** `?page=&page_size=` (coerced from query strings; defaults 1 / 25; max page_size 100). */
export const PaginationQuerySchema = z.object(paginationQueryShape);
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** Paginated list `{ items, page, page_size, total }`. */
export function paginated<T extends z.ZodType>(item: T) {
  return z.object({
    items: z.array(item),
    page: z.number().int().min(1),
    page_size: z.number().int().min(1).max(LIMITS.PAGE_SIZE_MAX),
    total: z.number().int().min(0),
  });
}
export interface Paginated<T> {
  items: T[];
  page: number;
  page_size: number;
  total: number;
}

/** Bounded, unpaginated collection `{ items }` (keys, members, sessions, …). */
export function listOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item) });
}

/** Query-string boolean: "true"/"false"/"1"/"0"/"yes"/"no"/"on"/"off". */
export const QueryBooleanSchema = z.stringbool();
/** Free-text search query parameter. */
export const SearchQuerySchema = z.string().trim().min(1).max(LIMITS.SEARCH_QUERY_MAX);

export const OkResponseSchema = z.object({ ok: z.literal(true) });
export type OkResponse = z.infer<typeof OkResponseSchema>;

/** Body of an action that only needs a reason (revocations). */
export const ReasonRequestSchema = z.object({
  reason: requiredText(LIMITS.REVOKE_REASON_MIN, LIMITS.REVOKE_REASON_MAX),
});
export type ReasonRequest = z.infer<typeof ReasonRequestSchema>;

// ---------------------------------------------------------------------------
// Path params
// ---------------------------------------------------------------------------

export const UuidParamsSchema = z.object({ id: UuidSchema });
export type UuidParams = z.infer<typeof UuidParamsSchema>;
