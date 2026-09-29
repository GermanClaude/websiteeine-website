/**
 * Web report endpoints (§11.1, §13 "Reports"). Plugin in-game reports live in player.ts.
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { ReporterTypeSchema, ReportStatusSchema } from '../enums';
import {
  CaseNumberSchema,
  IsoDateTimeSchema,
  optionalText,
  paginated,
  paginationQueryShape,
  PlayerRefSchema,
  PlayerSummarySchema,
  QueryBooleanSchema,
  requiredText,
  ReviewerRefSchema,
  ServerIdSchema,
  ServerRefSchema,
  UserIdStringSchema,
  UserRefSchema,
  UuidSchema,
} from './common';

export { ReportCreateResponseSchema, type ReportCreateResponse } from './player';

export const ReportViewSchema = z.object({
  id: UuidSchema,
  case_number: CaseNumberSchema,
  player: PlayerSummarySchema,
  /** Server where it happened / that submitted it. */
  server: ServerRefSchema.nullable(),
  reporter_type: ReporterTypeSchema,
  /** Reporting web user (reporter_type user). */
  reporter_user: UserRefSchema.nullable(),
  /** In-game reporter (reporter_type server). */
  reporter_player: PlayerSummarySchema.nullable(),
  reason: z.string(),
  description: z.string().nullable(),
  status: ReportStatusSchema,
  resolution_note: z.string().nullable(),
  resolved_by: ReviewerRefSchema.nullable(),
  resolved_at: IsoDateTimeSchema.nullable(),
  evidence_count: z.number().int().min(0),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type ReportView = z.infer<typeof ReportViewSchema>;

export const ReportListQuerySchema = z.object({
  ...paginationQueryShape,
  status: ReportStatusSchema.optional(),
  case: CaseNumberSchema.optional(),
  player: UserIdStringSchema.optional(),
  server_id: ServerIdSchema.optional(),
  /** Only reports created by the caller (implicit without report:review). */
  mine: QueryBooleanSchema.optional(),
});
export type ReportListQuery = z.infer<typeof ReportListQuerySchema>;

export const ReportListResponseSchema = paginated(ReportViewSchema);
export type ReportListResponse = z.infer<typeof ReportListResponseSchema>;

/** POST /reports (report:create). Attaches to the player's open case or creates one. */
export const ReportCreateRequestSchema = z.object({
  player: PlayerRefSchema,
  reason: requiredText(LIMITS.REPORT_REASON_MIN, LIMITS.REPORT_REASON_MAX),
  description: optionalText(LIMITS.REPORT_DESCRIPTION_MAX),
  /** Server where it happened (optional). */
  server_id: ServerIdSchema.nullish(),
});
export type ReportCreateRequest = z.infer<typeof ReportCreateRequestSchema>;

/** POST /reports/{id}/status (report:review) — a note is mandatory. */
export const ReportStatusChangeRequestSchema = z.object({
  status: ReportStatusSchema,
  note: requiredText(LIMITS.REPORT_NOTE_MIN, LIMITS.REPORT_NOTE_MAX),
});
export type ReportStatusChangeRequest = z.infer<typeof ReportStatusChangeRequestSchema>;

export const ReportParamsSchema = z.object({ id: UuidSchema });
export type ReportParams = z.infer<typeof ReportParamsSchema>;
