/**
 * VPN / account-age whitelist requests (§11.6, §13 "Whitelist").
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { WhitelistDecisionSchema, WhitelistRequestStatusSchema, WhitelistRequestTypeSchema } from '../enums';
import {
  IsoDateTimeSchema,
  optionalText,
  paginated,
  paginationQueryShape,
  PlayerSummarySchema,
  QueryBooleanSchema,
  requiredText,
  ServerIdSchema,
  ServerRefSchema,
  UserRefSchema,
  UuidSchema,
} from './common';

export const WhitelistRequestParamsSchema = z.object({ id: UuidSchema });
export type WhitelistRequestParams = z.infer<typeof WhitelistRequestParamsSchema>;

export const WhitelistRequestViewSchema = z.object({
  id: UuidSchema,
  player: PlayerSummarySchema,
  requester: UserRefSchema,
  server: ServerRefSchema,
  type: WhitelistRequestTypeSchema,
  reason: z.string(),
  requested_days: z.number().int().min(LIMITS.WHITELIST_REQUESTED_DAYS_MIN).nullable(),
  status: WhitelistRequestStatusSchema,
  decided_by: UserRefSchema.nullable(),
  decided_at: IsoDateTimeSchema.nullable(),
  decision_note: z.string().nullable(),
  bypass_id: UuidSchema.nullable(),
  bypass_expires_at: IsoDateTimeSchema.nullable(),
  /** Auto-expiry of a pending request. */
  expires_at: IsoDateTimeSchema,
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type WhitelistRequestView = z.infer<typeof WhitelistRequestViewSchema>;

export const WhitelistRequestListQuerySchema = z.object({
  ...paginationQueryShape,
  status: WhitelistRequestStatusSchema.optional(),
  type: WhitelistRequestTypeSchema.optional(),
  server_id: ServerIdSchema.optional(),
  /** Only requests submitted by the caller. */
  mine: QueryBooleanSchema.optional(),
});
export type WhitelistRequestListQuery = z.infer<typeof WhitelistRequestListQuerySchema>;

export const WhitelistRequestListResponseSchema = paginated(WhitelistRequestViewSchema);
export type WhitelistRequestListResponse = z.infer<typeof WhitelistRequestListResponseSchema>;

/** POST /whitelist-requests — player with linked identity. */
export const WhitelistRequestCreateRequestSchema = z.object({
  server_id: ServerIdSchema,
  type: WhitelistRequestTypeSchema,
  reason: requiredText(LIMITS.WHITELIST_REASON_MIN, LIMITS.WHITELIST_REASON_MAX),
  requested_days: z
    .number()
    .int()
    .min(LIMITS.WHITELIST_REQUESTED_DAYS_MIN)
    .max(LIMITS.WHITELIST_REQUESTED_DAYS_MAX)
    .nullish(),
});
export type WhitelistRequestCreateRequest = z.infer<typeof WhitelistRequestCreateRequestSchema>;

/**
 * POST /whitelist-requests/{id}/decision. `days` only with approve; omitted days on approve
 * means no expiry (if the server allows permanent bypasses).
 */
export const WhitelistDecisionRequestSchema = z
  .object({
    decision: WhitelistDecisionSchema,
    note: optionalText(LIMITS.WHITELIST_DECISION_NOTE_MAX),
    days: z.number().int().min(1).max(LIMITS.BYPASS_DAYS_MAX).nullish(),
  })
  .refine((body) => body.decision === 'approve' || body.days === undefined || body.days === null, {
    message: 'days is only allowed when approving',
    path: ['days'],
  });
export type WhitelistDecisionRequest = z.infer<typeof WhitelistDecisionRequestSchema>;

/** POST /whitelist-requests/{id}/revoke. */
export const WhitelistRevokeRequestSchema = z.object({
  reason: requiredText(LIMITS.REVOKE_REASON_MIN, LIMITS.REVOKE_REASON_MAX),
});
export type WhitelistRevokeRequest = z.infer<typeof WhitelistRevokeRequestSchema>;
