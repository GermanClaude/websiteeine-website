/**
 * Security monitor views (§13 "Admin" — intrusion detection & anomaly flagging).
 *
 *   GET  /api/v1/admin/security/events          (security:view)
 *   GET  /api/v1/admin/security/blocks          (security:view)
 *   POST /api/v1/admin/security/blocks/{id}/clear (security:manage)
 *   GET  /api/v1/admin/security/summary         (security:view)
 *
 * Sources are privacy-preserving identifiers only (HMAC network hash, user id, server id);
 * a raw IP never appears in any field.
 */
import { z } from 'zod';
import {
  SecurityActionTakenSchema,
  SecurityEventKindSchema,
  SecuritySeveritySchema,
  SecuritySourceTypeSchema,
  SECURITY_SEVERITIES,
} from '../enums';
import { IsoDateTimeSchema, listOf, optionalText, paginated, paginationQueryShape, UuidSchema } from './common';

/** Opaque block id (`<source_type>.<source_ref>`); the blocks list returns it. */
export const SecurityBlockIdSchema = z
  .string()
  .regex(/^(network|user|server|unknown)\.[A-Za-z0-9_.@:-]{1,200}$/, 'Invalid block id');

/** A privacy-preserving source reference (hash / user id / server id — never a raw IP). */
export const SecuritySourceRefSchema = z.string().max(200);

export const SecurityEventViewSchema = z.object({
  id: UuidSchema,
  created_at: IsoDateTimeSchema,
  kind: SecurityEventKindSchema,
  severity: SecuritySeveritySchema,
  source_type: SecuritySourceTypeSchema,
  source_ref: SecuritySourceRefSchema.nullable(),
  score: z.number().nullable(),
  action_taken: SecurityActionTakenSchema,
  endpoint: z.string().nullable(),
  request_id: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()),
  expires_at: IsoDateTimeSchema.nullable(),
});
export type SecurityEventView = z.infer<typeof SecurityEventViewSchema>;

export const SecurityEventListQuerySchema = z
  .object({
    ...paginationQueryShape,
    kind: SecurityEventKindSchema.optional(),
    severity: SecuritySeveritySchema.optional(),
    source_type: SecuritySourceTypeSchema.optional(),
    source_ref: z.string().trim().min(1).max(200).optional(),
    from: IsoDateTimeSchema.optional(),
    to: IsoDateTimeSchema.optional(),
  })
  .refine((q) => q.from === undefined || q.to === undefined || Date.parse(q.from) <= Date.parse(q.to), {
    message: '`from` must not be after `to`',
    path: ['from'],
  });
export type SecurityEventListQuery = z.infer<typeof SecurityEventListQuerySchema>;

export const SecurityEventListResponseSchema = paginated(SecurityEventViewSchema);
export type SecurityEventListResponse = z.infer<typeof SecurityEventListResponseSchema>;

/** An active, transient block held in the short-lived store. */
export const SecurityBlockViewSchema = z.object({
  id: SecurityBlockIdSchema,
  source_type: SecuritySourceTypeSchema,
  source_ref: SecuritySourceRefSchema,
  /** Current score at the time of the block. */
  score: z.number().nullable(),
  /** 1 for a first block, higher after repeated offences (exponential backoff). */
  strikes: z.number().int().min(1),
  expires_at: IsoDateTimeSchema,
  /** Remaining time to live in seconds. */
  ttl_seconds: z.number().int().min(0),
});
export type SecurityBlockView = z.infer<typeof SecurityBlockViewSchema>;

export const SecurityBlockListResponseSchema = listOf(SecurityBlockViewSchema);
export type SecurityBlockListResponse = z.infer<typeof SecurityBlockListResponseSchema>;

export const SecurityBlockIdParamsSchema = z.object({ id: SecurityBlockIdSchema });
export type SecurityBlockIdParams = z.infer<typeof SecurityBlockIdParamsSchema>;

/** Optional reason for clearing a block (audited). */
export const SecurityBlockClearRequestSchema = z.object({
  reason: optionalText(500),
});
export type SecurityBlockClearRequest = z.infer<typeof SecurityBlockClearRequestSchema>;

export const SecurityBlockClearResponseSchema = z.object({
  ok: z.literal(true),
  /** false when the block had already expired / did not exist. */
  cleared: z.boolean(),
  source_type: SecuritySourceTypeSchema,
  source_ref: SecuritySourceRefSchema,
});
export type SecurityBlockClearResponse = z.infer<typeof SecurityBlockClearResponseSchema>;

const severityCountsShape = Object.fromEntries(
  SECURITY_SEVERITIES.map((severity) => [severity, z.number().int().min(0)]),
) as Record<(typeof SECURITY_SEVERITIES)[number], z.ZodNumber>;

export const SecuritySummaryTopSourceSchema = z.object({
  source_type: SecuritySourceTypeSchema,
  source_ref: SecuritySourceRefSchema,
  event_count: z.number().int().min(0),
  max_severity: SecuritySeveritySchema,
});
export type SecuritySummaryTopSource = z.infer<typeof SecuritySummaryTopSourceSchema>;

export const SecuritySummaryResponseSchema = z.object({
  /** Event counts in the last 24h, by severity. */
  events_last_24h: z.object(severityCountsShape),
  /** Total events in the last 24h. */
  total_events_last_24h: z.number().int().min(0),
  /** Anomaly review items in the last 24h. */
  anomalies_last_24h: z.number().int().min(0),
  active_blocks: z.number().int().min(0),
  top_sources: z.array(SecuritySummaryTopSourceSchema),
  detection_enabled: z.boolean(),
  anomaly_enabled: z.boolean(),
  generated_at: IsoDateTimeSchema,
});
export type SecuritySummaryResponse = z.infer<typeof SecuritySummaryResponseSchema>;
