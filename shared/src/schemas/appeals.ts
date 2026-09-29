/**
 * Appeals (§11.5, §13 "Appeals").
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { AppealDecisionSchema, AppealStatusSchema } from '../enums';
import {
  CaseNumberSchema,
  IsoDateTimeSchema,
  paginated,
  paginationQueryShape,
  PlayerSummarySchema,
  QueryBooleanSchema,
  requiredText,
  ReviewerRefSchema,
  UserRefSchema,
  UuidSchema,
} from './common';

export const AppealParamsSchema = z.object({ id: UuidSchema });
export type AppealParams = z.infer<typeof AppealParamsSchema>;

export const AppealViewSchema = z.object({
  id: UuidSchema,
  case_number: CaseNumberSchema,
  player: PlayerSummarySchema,
  submitted_by: UserRefSchema,
  statement: z.string(),
  status: AppealStatusSchema,
  assigned_reviewer: ReviewerRefSchema.nullable(),
  decision: AppealDecisionSchema.nullable(),
  decision_reason: z.string().nullable(),
  decided_by: ReviewerRefSchema.nullable(),
  decided_at: IsoDateTimeSchema.nullable(),
  /** Decided despite a conflict of interest (super_admin override, audited). */
  conflict_override: z.boolean(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type AppealView = z.infer<typeof AppealViewSchema>;

export const AppealListQuerySchema = z.object({
  ...paginationQueryShape,
  status: AppealStatusSchema.optional(),
  case: CaseNumberSchema.optional(),
  assigned_to_me: QueryBooleanSchema.optional(),
});
export type AppealListQuery = z.infer<typeof AppealListQuerySchema>;

export const AppealListResponseSchema = paginated(AppealViewSchema);
export type AppealListResponse = z.infer<typeof AppealListResponseSchema>;

/** POST /appeals — only by the linked player, only for confirmed/inconclusive cases. */
export const AppealCreateRequestSchema = z.object({
  case_id: CaseNumberSchema,
  statement: requiredText(LIMITS.APPEAL_STATEMENT_MIN, LIMITS.APPEAL_STATEMENT_MAX),
});
export type AppealCreateRequest = z.infer<typeof AppealCreateRequestSchema>;

/** POST /appeals/{id}/assign (appeal:assign). */
export const AppealAssignRequestSchema = z.object({
  reviewer_user_id: UuidSchema,
});
export type AppealAssignRequest = z.infer<typeof AppealAssignRequestSchema>;

/** POST /appeals/{id}/decision (appeal:decide). */
export const AppealDecisionRequestSchema = z.object({
  decision: AppealDecisionSchema,
  reason: requiredText(LIMITS.APPEAL_DECISION_REASON_MIN, LIMITS.APPEAL_DECISION_REASON_MAX),
  /** Only honoured with appeal:override_conflict. */
  override_conflict: z.boolean().default(false),
});
export type AppealDecisionRequest = z.infer<typeof AppealDecisionRequestSchema>;

/** POST /appeals/{id}/withdraw — by the submitter. */
export const AppealWithdrawRequestSchema = z.object({});
export type AppealWithdrawRequest = z.infer<typeof AppealWithdrawRequestSchema>;
