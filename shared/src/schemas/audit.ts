/**
 * Audit log views (§9, §13 "Admin"): /admin/audit and /admin/audit/verify.
 */
import { z } from 'zod';
import { ActorTypeSchema, AuditActionSchema, AuditVerifyFailureSchema } from '../enums';
import {
  CaseNumberSchema,
  IsoDateTimeSchema,
  paginated,
  paginationQueryShape,
  ServerIdSchema,
  Sha256HexSchema,
  UuidSchema,
} from './common';

/** Full audit event (audit:view). */
export const AuditEventViewSchema = z.object({
  seq: z.number().int().min(1),
  event_id: UuidSchema,
  created_at: IsoDateTimeSchema,
  actor_type: ActorTypeSchema,
  actor_id: z.string().nullable(),
  /** Human label for the actor (username, `srv_…`, `system`); not part of the hash. */
  actor_label: z.string().nullable(),
  action: AuditActionSchema,
  target_type: z.string(),
  target_id: z.string().nullable(),
  /** servers.id / cases.id (uuid) as hashed. */
  server_id: UuidSchema.nullable(),
  case_id: UuidSchema.nullable(),
  metadata: z.record(z.string(), z.unknown()),
  request_id: z.string().nullable(),
  prev_hash: Sha256HexSchema,
  hash: Sha256HexSchema,
});
export type AuditEventView = z.infer<typeof AuditEventViewSchema>;

/**
 * Reduced event for case history and the dashboard. Reviewers appear only by pseudonym in
 * `actor_label`; no internal ids, metadata or hashes.
 */
export const AuditEventSummarySchema = z.object({
  seq: z.number().int().min(1),
  event_id: UuidSchema,
  created_at: IsoDateTimeSchema,
  action: AuditActionSchema,
  actor_type: ActorTypeSchema,
  actor_label: z.string().nullable(),
  target_type: z.string(),
  target_id: z.string().nullable(),
});
export type AuditEventSummary = z.infer<typeof AuditEventSummarySchema>;

export const AuditListQuerySchema = z
  .object({
    ...paginationQueryShape,
    actor_type: ActorTypeSchema.optional(),
    actor_id: z.string().trim().min(1).max(128).optional(),
    action: AuditActionSchema.optional(),
    target_type: z.string().trim().min(1).max(64).optional(),
    target_id: z.string().trim().min(1).max(128).optional(),
    server_id: ServerIdSchema.optional(),
    case: CaseNumberSchema.optional(),
    from: IsoDateTimeSchema.optional(),
    to: IsoDateTimeSchema.optional(),
  })
  .refine((query) => query.from === undefined || query.to === undefined || Date.parse(query.from) <= Date.parse(query.to), {
    message: '`from` must not be after `to`',
    path: ['from'],
  });
export type AuditListQuery = z.infer<typeof AuditListQuerySchema>;

export const AuditListResponseSchema = paginated(AuditEventViewSchema);
export type AuditListResponse = z.infer<typeof AuditListResponseSchema>;

/** GET /admin/audit/verify (audit:verify) — recomputes the chain. */
export const AuditVerifyResponseSchema = z.object({
  valid: z.boolean(),
  checked_events: z.number().int().min(0),
  /** First seq whose hash or prev_hash does not match; null when valid. */
  first_broken_seq: z.number().int().min(1).nullable(),
  failure: AuditVerifyFailureSchema.nullable(),
  last_seq: z.number().int().min(1).nullable(),
  last_hash: Sha256HexSchema.nullable(),
  verified_at: IsoDateTimeSchema,
});
export type AuditVerifyResponse = z.infer<typeof AuditVerifyResponseSchema>;
