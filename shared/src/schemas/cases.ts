/**
 * Cases (§4.5, §11.1, §11.2, §11.4, §13 "Cases"): staff views, public view, review actions,
 * server confirmations.
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { AppealStatusSchema, CaseStatusSchema, CaseVerdictSchema, ReviewKindSchema } from '../enums';
import { AppealViewSchema } from './appeals';
import { AuditEventSummarySchema } from './audit';
import {
  CaseNumberSchema,
  IsoDateTimeSchema,
  optionalText,
  paginated,
  paginationQueryShape,
  PlayerRefSchema,
  PlayerSummarySchema,
  requiredText,
  ReviewerRefSchema,
  SearchQuerySchema,
  ServerIdSchema,
  ServerRefSchema,
  UserIdStringSchema,
  UserRefSchema,
  UuidSchema,
} from './common';
import { EvidenceViewSchema } from './evidence';
import { ReportViewSchema } from './reports';

export const CaseParamsSchema = z.object({ caseNumber: CaseNumberSchema });
export type CaseParams = z.infer<typeof CaseParamsSchema>;

export const CaseConfirmationParamsSchema = z.object({ caseNumber: CaseNumberSchema, id: UuidSchema });
export type CaseConfirmationParams = z.infer<typeof CaseConfirmationParamsSchema>;

// ---------------------------------------------------------------------------
// Lists
// ---------------------------------------------------------------------------

export const CaseSummarySchema = z.object({
  case_number: CaseNumberSchema,
  player: PlayerSummarySchema,
  status: CaseStatusSchema,
  verdict: CaseVerdictSchema,
  reason: z.string(),
  report_count: z.number().int().min(0),
  open_report_count: z.number().int().min(0),
  evidence_count: z.number().int().min(0),
  confirmed_servers: z.number().int().min(0),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type CaseSummary = z.infer<typeof CaseSummarySchema>;

/** GET /cases (case:view_staff; server_admin only sees cases of own servers). */
export const CaseListQuerySchema = z.object({
  ...paginationQueryShape,
  status: CaseStatusSchema.optional(),
  verdict: CaseVerdictSchema.optional(),
  player: UserIdStringSchema.optional(),
  q: SearchQuerySchema.optional(),
  server_id: ServerIdSchema.optional(),
});
export type CaseListQuery = z.infer<typeof CaseListQuerySchema>;

export const CaseListResponseSchema = paginated(CaseSummarySchema);
export type CaseListResponse = z.infer<typeof CaseListResponseSchema>;

// ---------------------------------------------------------------------------
// Staff view
// ---------------------------------------------------------------------------

/** Review history entry; reviewers are shown by pseudonym. Immutable. */
export const CaseReviewViewSchema = z.object({
  id: UuidSchema,
  kind: ReviewKindSchema,
  reviewer: ReviewerRefSchema,
  previous_verdict: CaseVerdictSchema.nullable(),
  new_verdict: CaseVerdictSchema.nullable(),
  comment: z.string(),
  appeal_id: UuidSchema.nullable(),
  created_at: IsoDateTimeSchema,
});
export type CaseReviewView = z.infer<typeof CaseReviewViewSchema>;

export const CaseConfirmationViewSchema = z.object({
  id: UuidSchema,
  server: ServerRefSchema,
  confirmed_by: UserRefSchema,
  note: z.string().nullable(),
  created_at: IsoDateTimeSchema,
  revoked_at: IsoDateTimeSchema.nullable(),
  revoke_reason: z.string().nullable(),
  /** Not revoked. */
  active: z.boolean(),
});
export type CaseConfirmationView = z.infer<typeof CaseConfirmationViewSchema>;

/** GET /cases/{caseNumber}. */
export const CaseStaffViewSchema = z.object({
  id: UuidSchema,
  case_number: CaseNumberSchema,
  player: PlayerSummarySchema,
  status: CaseStatusSchema,
  verdict: CaseVerdictSchema,
  reason: z.string(),
  public_summary: z.string().nullable(),
  verdict_set_by: ReviewerRefSchema.nullable(),
  verdict_set_at: IsoDateTimeSchema.nullable(),
  closed_at: IsoDateTimeSchema.nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
  /** Distinct active confirmations / distinct owners among them. Never change a verdict. */
  confirmed_servers: z.number().int().min(0),
  independent_confirmed_servers: z.number().int().min(0),
  reports: z.array(ReportViewSchema),
  evidence: z.array(EvidenceViewSchema),
  reviews: z.array(CaseReviewViewSchema),
  appeals: z.array(AppealViewSchema),
  confirmations: z.array(CaseConfirmationViewSchema),
  history: z.array(AuditEventSummarySchema),
});
export type CaseStaffView = z.infer<typeof CaseStaffViewSchema>;

// ---------------------------------------------------------------------------
// Public view — GET /public/cases/{caseNumber} (intentionally limited)
// ---------------------------------------------------------------------------

export const CasePublicViewSchema = z.object({
  case_number: CaseNumberSchema,
  player: z.object({
    user_id: UserIdStringSchema,
    display_name: z.string().nullable(),
  }),
  status: CaseStatusSchema,
  verdict: CaseVerdictSchema,
  public_summary: z.string().nullable(),
  verdict_set_at: IsoDateTimeSchema.nullable(),
  report_count: z.number().int().min(0),
  evidence_count: z.number().int().min(0),
  verified_evidence_count: z.number().int().min(0),
  confirmed_servers: z.number().int().min(0),
  appeal_status: AppealStatusSchema.nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type CasePublicView = z.infer<typeof CasePublicViewSchema>;

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/** POST /cases (case:create). */
export const CaseCreateRequestSchema = z.object({
  player: PlayerRefSchema,
  reason: requiredText(LIMITS.CASE_REASON_MIN, LIMITS.CASE_REASON_MAX),
  public_summary: optionalText(LIMITS.CASE_PUBLIC_SUMMARY_MAX),
});
export type CaseCreateRequest = z.infer<typeof CaseCreateRequestSchema>;

/** Minimal state returned by case mutations (clients refetch the full view). */
export const CaseMutationResponseSchema = z.object({
  case_number: CaseNumberSchema,
  status: CaseStatusSchema,
  verdict: CaseVerdictSchema,
  updated_at: IsoDateTimeSchema,
});
export type CaseMutationResponse = z.infer<typeof CaseMutationResponseSchema>;

const commentSchema = requiredText(LIMITS.REVIEW_COMMENT_MIN, LIMITS.REVIEW_COMMENT_MAX);

/** POST /cases/{caseNumber}/reviews/start and /notes and /reopen. */
export const CaseCommentRequestSchema = z.object({ comment: commentSchema });
export type CaseCommentRequest = z.infer<typeof CaseCommentRequestSchema>;
export const CaseReviewStartRequestSchema = CaseCommentRequestSchema;
export type CaseReviewStartRequest = CaseCommentRequest;
export const CaseNoteRequestSchema = CaseCommentRequestSchema;
export type CaseNoteRequest = CaseCommentRequest;
export const CaseReopenRequestSchema = CaseCommentRequestSchema;
export type CaseReopenRequest = CaseCommentRequest;

/** Verdicts settable by a reviewer (`unknown` is only the initial state). */
export const SettableCaseVerdictSchema = CaseVerdictSchema.exclude(['unknown']);

/** POST /cases/{caseNumber}/verdict (case:set_verdict, 2FA session). */
export const CaseVerdictRequestSchema = z.object({
  verdict: SettableCaseVerdictSchema,
  comment: commentSchema,
  public_summary: optionalText(LIMITS.CASE_PUBLIC_SUMMARY_MAX),
});
export type CaseVerdictRequest = z.infer<typeof CaseVerdictRequestSchema>;

/** POST /cases/{caseNumber}/confirmations — caller must be owner/admin of that active server. */
export const CaseConfirmationCreateRequestSchema = z.object({
  server_id: ServerIdSchema,
  note: optionalText(LIMITS.CONFIRMATION_NOTE_MAX),
});
export type CaseConfirmationCreateRequest = z.infer<typeof CaseConfirmationCreateRequestSchema>;

/** DELETE /cases/{caseNumber}/confirmations/{id} — soft revoke; body optional. */
export const CaseConfirmationRevokeRequestSchema = z.object({
  reason: optionalText(LIMITS.REVOKE_REASON_MAX),
});
export type CaseConfirmationRevokeRequest = z.infer<typeof CaseConfirmationRevokeRequestSchema>;
