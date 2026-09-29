/**
 * Server schemas: plugin registration / heartbeat / key rotation (§5, §6) and the web
 * server-management API (§13 "Servers").
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { ServerKeyStatusSchema, ServerMemberRoleSchema, ServerStatusSchema } from '../enums';
import { REGISTRATION_TOKEN_REGEX } from '../formats';
import {
  EpochMsSchema,
  GameVersionSchema,
  IsoDateTimeSchema,
  KeyFingerprintSchema,
  listOf,
  optionalText,
  patchText,
  paginated,
  paginationQueryShape,
  PluginVersionSchema,
  PublicKeyB64Schema,
  requiredText,
  SearchQuerySchema,
  ServerIdSchema,
  SignatureB64Schema,
  UserRefSchema,
  UsernameSchema,
  UuidSchema,
} from './common';

export const RegistrationTokenSchema = z.string().regex(REGISTRATION_TOKEN_REGEX, 'Invalid registration token');

// ---------------------------------------------------------------------------
// Plugin endpoints
// ---------------------------------------------------------------------------

/** GET /time (unsigned). */
export const TimeResponseSchema = z.object({
  server_time: IsoDateTimeSchema,
  epoch_ms: EpochMsSchema,
});
export type TimeResponse = z.infer<typeof TimeResponseSchema>;

/** POST /servers/register — token + proof of possession (§5.2). */
export const ServerRegisterRequestSchema = z.object({
  registration_token: RegistrationTokenSchema,
  public_key: PublicKeyB64Schema,
  plugin_version: PluginVersionSchema,
  game_version: GameVersionSchema.nullish(),
  timestamp: EpochMsSchema,
  pop_signature: SignatureB64Schema,
});
export type ServerRegisterRequest = z.infer<typeof ServerRegisterRequestSchema>;

export const ServerRegisterResponseSchema = z.object({
  server_id: ServerIdSchema,
  key_fingerprint: KeyFingerprintSchema,
  status: ServerStatusSchema,
  server_time: IsoDateTimeSchema,
});
export type ServerRegisterResponse = z.infer<typeof ServerRegisterResponseSchema>;

/** POST /servers/heartbeat (signed). */
export const ServerHeartbeatRequestSchema = z.object({
  server_id: ServerIdSchema.optional(),
  plugin_version: PluginVersionSchema,
  game_version: GameVersionSchema.nullish(),
  player_count: z.number().int().min(0).max(LIMITS.PLAYER_COUNT_MAX).nullish(),
});
export type ServerHeartbeatRequest = z.infer<typeof ServerHeartbeatRequestSchema>;

export const ServerHeartbeatResponseSchema = z.object({
  status: ServerStatusSchema,
  policy_version: z.number().int().min(1).nullable(),
  key_rotation_requested: z.boolean(),
  server_time: IsoDateTimeSchema,
});
export type ServerHeartbeatResponse = z.infer<typeof ServerHeartbeatResponseSchema>;

/** POST /servers/keys/rotate — signed with the CURRENT key, PoP by the NEW key (§5.5). */
export const KeyRotateRequestSchema = z.object({
  new_public_key: PublicKeyB64Schema,
  timestamp: EpochMsSchema,
  pop_signature: SignatureB64Schema,
});
export type KeyRotateRequest = z.infer<typeof KeyRotateRequestSchema>;

export const KeyRotateResponseSchema = z.object({
  key_fingerprint: KeyFingerprintSchema,
  previous_key_fingerprint: KeyFingerprintSchema,
  previous_key_retiring_until: IsoDateTimeSchema,
  server_time: IsoDateTimeSchema,
});
export type KeyRotateResponse = z.infer<typeof KeyRotateResponseSchema>;

// ---------------------------------------------------------------------------
// Web: server views
// ---------------------------------------------------------------------------

export const ServerParamsSchema = z.object({ id: ServerIdSchema });
export type ServerParams = z.infer<typeof ServerParamsSchema>;

export const ServerKeyParamsSchema = z.object({ id: ServerIdSchema, keyId: UuidSchema });
export type ServerKeyParams = z.infer<typeof ServerKeyParamsSchema>;

export const ServerMemberParamsSchema = z.object({ id: ServerIdSchema, userId: UuidSchema });
export type ServerMemberParams = z.infer<typeof ServerMemberParamsSchema>;

/** Compact server row (lists, dashboard server status). */
export const ServerSummarySchema = z.object({
  server_id: ServerIdSchema,
  name: z.string(),
  status: ServerStatusSchema,
  is_trusted: z.boolean(),
  key_fingerprint: KeyFingerprintSchema.nullable(),
  plugin_version: z.string().nullable(),
  last_seen_at: IsoDateTimeSchema.nullable(),
  /** Caller's membership role (null when visible through server:manage_any). */
  member_role: ServerMemberRoleSchema.nullable(),
});
export type ServerSummary = z.infer<typeof ServerSummarySchema>;

/** Server dashboard (§22): id, status, active key fingerprint, dates, plugin version, config. */
export const ServerViewSchema = ServerSummarySchema.extend({
  description: z.string().nullable(),
  owner: UserRefSchema,
  accepts_whitelist_requests: z.boolean(),
  game_version: z.string().nullable(),
  registered_at: IsoDateTimeSchema.nullable(),
  key_rotation_requested_at: IsoDateTimeSchema.nullable(),
  policy_version: z.number().int().min(1).nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type ServerView = z.infer<typeof ServerViewSchema>;

export const ServerListQuerySchema = z.object({
  ...paginationQueryShape,
  q: SearchQuerySchema.optional(),
  status: ServerStatusSchema.optional(),
});
export type ServerListQuery = z.infer<typeof ServerListQuerySchema>;

export const ServerListResponseSchema = paginated(ServerSummarySchema);
export type ServerListResponse = z.infer<typeof ServerListResponseSchema>;

export const ServerNameSchema = requiredText(LIMITS.SERVER_NAME_MIN, LIMITS.SERVER_NAME_MAX);

/** POST /servers (server:create). */
export const ServerCreateRequestSchema = z.object({
  name: ServerNameSchema,
  description: optionalText(LIMITS.SERVER_DESCRIPTION_MAX),
  accepts_whitelist_requests: z.boolean().default(true),
});
export type ServerCreateRequest = z.infer<typeof ServerCreateRequestSchema>;

/** Registration token — returned exactly once. */
export const RegistrationTokenResponseSchema = z.object({
  registration_token: RegistrationTokenSchema,
  expires_at: IsoDateTimeSchema,
});
export type RegistrationTokenResponse = z.infer<typeof RegistrationTokenResponseSchema>;

export const ServerCreateResponseSchema = z.object({
  server: ServerViewSchema,
  registration_token: RegistrationTokenSchema,
  registration_token_expires_at: IsoDateTimeSchema,
});
export type ServerCreateResponse = z.infer<typeof ServerCreateResponseSchema>;

/** PATCH /servers/{id}. */
export const ServerUpdateRequestSchema = z
  .object({
    name: ServerNameSchema.optional(),
    description: patchText(LIMITS.SERVER_DESCRIPTION_MAX),
    accepts_whitelist_requests: z.boolean().optional(),
  })
  .refine(
    (body) => body.name !== undefined || body.description !== undefined || body.accepts_whitelist_requests !== undefined,
    { message: 'At least one field must be provided' },
  );
export type ServerUpdateRequest = z.infer<typeof ServerUpdateRequestSchema>;

/** POST /servers/{id}/status (server:manage_any). `pending` cannot be set manually. */
export const ServerStatusChangeRequestSchema = z.object({
  status: z.enum(['active', 'suspended', 'revoked']),
  reason: requiredText(LIMITS.REVOKE_REASON_MIN, LIMITS.REVOKE_REASON_MAX),
});
export type ServerStatusChangeRequest = z.infer<typeof ServerStatusChangeRequestSchema>;

/** POST /servers/{id}/trust (server:trust). */
export const ServerTrustRequestSchema = z.object({
  is_trusted: z.boolean(),
  reason: optionalText(LIMITS.REVOKE_REASON_MAX),
});
export type ServerTrustRequest = z.infer<typeof ServerTrustRequestSchema>;

// ---------------------------------------------------------------------------
// Web: keys
// ---------------------------------------------------------------------------

export const ServerKeyViewSchema = z.object({
  id: UuidSchema,
  fingerprint: KeyFingerprintSchema,
  public_key: PublicKeyB64Schema,
  status: ServerKeyStatusSchema,
  created_at: IsoDateTimeSchema,
  activated_at: IsoDateTimeSchema.nullable(),
  retiring_until: IsoDateTimeSchema.nullable(),
  retired_at: IsoDateTimeSchema.nullable(),
  revoked_at: IsoDateTimeSchema.nullable(),
  revoke_reason: z.string().nullable(),
});
export type ServerKeyView = z.infer<typeof ServerKeyViewSchema>;

export const ServerKeyListResponseSchema = listOf(ServerKeyViewSchema);
export type ServerKeyListResponse = z.infer<typeof ServerKeyListResponseSchema>;

/** POST /servers/{id}/keys/{keyId}/revoke. */
export const KeyRevokeRequestSchema = z.object({
  reason: requiredText(LIMITS.REVOKE_REASON_MIN, LIMITS.REVOKE_REASON_MAX),
});
export type KeyRevokeRequest = z.infer<typeof KeyRevokeRequestSchema>;

/** POST /servers/{id}/keys/rotation-request — plugin rotates on next heartbeat. */
export const KeyRotationRequestResponseSchema = z.object({
  key_rotation_requested_at: IsoDateTimeSchema,
});
export type KeyRotationRequestResponse = z.infer<typeof KeyRotationRequestResponseSchema>;

// ---------------------------------------------------------------------------
// Web: members
// ---------------------------------------------------------------------------

export const ServerMemberViewSchema = z.object({
  user: UserRefSchema,
  role: ServerMemberRoleSchema,
  created_at: IsoDateTimeSchema,
  created_by: UserRefSchema.nullable(),
});
export type ServerMemberView = z.infer<typeof ServerMemberViewSchema>;

export const ServerMemberListResponseSchema = listOf(ServerMemberViewSchema);
export type ServerMemberListResponse = z.infer<typeof ServerMemberListResponseSchema>;

/** POST /servers/{id}/members — `owner` is never assignable (exactly one owner). */
export const ServerMemberAddRequestSchema = z.object({
  username: UsernameSchema,
  role: z.enum(['admin', 'moderator']),
});
export type ServerMemberAddRequest = z.infer<typeof ServerMemberAddRequestSchema>;
