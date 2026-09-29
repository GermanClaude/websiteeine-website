/**
 * Bypasses (§4.8, §11.6): direct server grants, global grants (admin) and views.
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { BypassScopeSchema, BypassTypeSchema } from '../enums';
import {
  IsoDateTimeSchema,
  paginated,
  paginationQueryShape,
  PlayerRefSchema,
  PlayerSummarySchema,
  QueryBooleanSchema,
  requiredText,
  ServerIdSchema,
  ServerRefSchema,
  UserIdStringSchema,
  UserRefSchema,
  UuidSchema,
} from './common';

/** Compact bypass as returned to the plugin (§6.1 `bypass.bypasses`, §6.2). */
export const BypassSummarySchema = z.object({
  id: UuidSchema,
  type: BypassTypeSchema,
  scope: BypassScopeSchema,
  expires_at: IsoDateTimeSchema.nullable(),
});
export type BypassSummary = z.infer<typeof BypassSummarySchema>;

export const BypassViewSchema = z.object({
  id: UuidSchema,
  player: PlayerSummarySchema,
  scope: BypassScopeSchema,
  server: ServerRefSchema.nullable(),
  type: BypassTypeSchema,
  reason: z.string(),
  granted_by: UserRefSchema,
  whitelist_request_id: UuidSchema.nullable(),
  created_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema.nullable(),
  revoked_at: IsoDateTimeSchema.nullable(),
  revoked_by: UserRefSchema.nullable(),
  revoke_reason: z.string().nullable(),
  /** revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now). */
  active: z.boolean(),
});
export type BypassView = z.infer<typeof BypassViewSchema>;

export const BypassListQuerySchema = z.object({
  ...paginationQueryShape,
  active: QueryBooleanSchema.optional(),
  type: BypassTypeSchema.optional(),
  player: UserIdStringSchema.optional(),
  server_id: ServerIdSchema.optional(),
});
export type BypassListQuery = z.infer<typeof BypassListQuerySchema>;

export const BypassListResponseSchema = paginated(BypassViewSchema);
export type BypassListResponse = z.infer<typeof BypassListResponseSchema>;

const futureTimestamp = IsoDateTimeSchema.refine(
  (value) => Date.parse(value) > Date.now(),
  'expires_at must be in the future',
);

/**
 * POST /servers/{id}/bypasses (bypass:manage on that server, scope `server`) and
 * POST /admin/bypasses (bypass:manage_global, scope `global`). Omitted expires_at = no expiry.
 */
export const BypassCreateRequestSchema = z.object({
  player: PlayerRefSchema,
  type: BypassTypeSchema,
  reason: requiredText(LIMITS.BYPASS_REASON_MIN, LIMITS.BYPASS_REASON_MAX),
  expires_at: futureTimestamp.nullish(),
});
export type BypassCreateRequest = z.infer<typeof BypassCreateRequestSchema>;

export const BypassRevokeRequestSchema = z.object({
  reason: requiredText(LIMITS.REVOKE_REASON_MIN, LIMITS.REVOKE_REASON_MAX),
});
export type BypassRevokeRequest = z.infer<typeof BypassRevokeRequestSchema>;

export const BypassParamsSchema = z.object({ id: UuidSchema });
export type BypassParams = z.infer<typeof BypassParamsSchema>;

/** Active iff not revoked and not expired at `now` (§4.8). */
export function isBypassActive(
  bypass: { revoked_at: string | Date | null; expires_at: string | Date | null },
  now: Date = new Date(),
): boolean {
  if (bypass.revoked_at !== null) return false;
  if (bypass.expires_at === null) return true;
  const expires = bypass.expires_at instanceof Date ? bypass.expires_at.getTime() : Date.parse(bypass.expires_at);
  return Number.isFinite(expires) && expires > now.getTime();
}
