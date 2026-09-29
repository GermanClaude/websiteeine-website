/**
 * Evidence (§4.6, §11.3) and the Overwatch proof API (§10.3).
 * Evidence carries three independent assessments (identity, authenticity, cheating) plus an
 * overall review status; none of them changes a case verdict (R2).
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import { EvidenceStatusSchema, EvidenceTypeSchema } from '../enums';
import { normalizeProofCode, PROOF_CODE_REGEX, TIMESTAMP_MS_REGEX } from '../signing';
import {
  CaseNumberSchema,
  HttpsUrlSchema,
  IsoDateTimeSchema,
  optionalText,
  paginated,
  paginationQueryShape,
  QueryBooleanSchema,
  requiredText,
  ReviewerRefSchema,
  ServerIdSchema,
  ServerRefSchema,
  Sha256HexSchema,
  UserIdStringSchema,
  UserRefSchema,
  UuidSchema,
} from './common';

export const EvidenceParamsSchema = z.object({ id: UuidSchema });
export type EvidenceParams = z.infer<typeof EvidenceParamsSchema>;

/** The three independent assessments + overall status. */
export const EvidenceAssessmentSchema = z.object({
  status: EvidenceStatusSchema,
  identity_status: EvidenceStatusSchema,
  authenticity_status: EvidenceStatusSchema,
  cheating_status: EvidenceStatusSchema,
});
export type EvidenceAssessment = z.infer<typeof EvidenceAssessmentSchema>;

export const EvidenceViewSchema = EvidenceAssessmentSchema.extend({
  id: UuidSchema,
  case_number: CaseNumberSchema,
  report_id: UuidSchema.nullable(),
  type: EvidenceTypeSchema,
  title: z.string(),
  description: z.string().nullable(),
  /** null only for `link` evidence. */
  sha256: Sha256HexSchema.nullable(),
  size_bytes: z.number().int().min(0).nullable(),
  mime_type: z.string().nullable(),
  original_filename: z.string().nullable(),
  external_url: z.string().nullable(),
  uploaded_at: IsoDateTimeSchema,
  uploader_user: UserRefSchema.nullable(),
  uploader_server: ServerRefSchema.nullable(),
  overwatch_session_id: UuidSchema.nullable(),
  supersedes_evidence_id: UuidSchema.nullable(),
  superseded_by_evidence_id: UuidSchema.nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type EvidenceView = z.infer<typeof EvidenceViewSchema>;

export const EvidenceReviewViewSchema = EvidenceAssessmentSchema.extend({
  id: UuidSchema,
  evidence_id: UuidSchema,
  reviewer: ReviewerRefSchema,
  comment: z.string(),
  created_at: IsoDateTimeSchema,
});
export type EvidenceReviewView = z.infer<typeof EvidenceReviewViewSchema>;

/** Result of `?verify=true` (re-hash of the stored object, reviewer+). */
export const EvidenceIntegritySchema = z.object({
  verified: z.boolean(),
  computed_sha256: Sha256HexSchema.nullable(),
  checked_at: IsoDateTimeSchema,
});
export type EvidenceIntegrity = z.infer<typeof EvidenceIntegritySchema>;

/** GET /evidence/{id}. */
export const EvidenceDetailSchema = EvidenceViewSchema.extend({
  reviews: z.array(EvidenceReviewViewSchema),
  integrity: EvidenceIntegritySchema.nullable(),
});
export type EvidenceDetail = z.infer<typeof EvidenceDetailSchema>;

export const EvidenceDetailQuerySchema = z.object({
  verify: QueryBooleanSchema.optional(),
});
export type EvidenceDetailQuery = z.infer<typeof EvidenceDetailQuerySchema>;

/** GET /evidence (evidence:view — review queue). */
export const EvidenceListQuerySchema = z.object({
  ...paginationQueryShape,
  status: EvidenceStatusSchema.optional(),
  type: EvidenceTypeSchema.optional(),
  case: CaseNumberSchema.optional(),
});
export type EvidenceListQuery = z.infer<typeof EvidenceListQuerySchema>;

export const EvidenceListResponseSchema = paginated(EvidenceViewSchema);
export type EvidenceListResponse = z.infer<typeof EvidenceListResponseSchema>;

/** Non-file multipart fields of POST /cases/{caseNumber}/evidence. */
export const EvidenceUploadFieldsSchema = z.object({
  type: EvidenceTypeSchema.exclude(['link']),
  title: requiredText(1, LIMITS.EVIDENCE_TITLE_MAX),
  description: optionalText(LIMITS.EVIDENCE_DESCRIPTION_MAX),
  report_id: UuidSchema.nullish(),
  overwatch_session_id: UuidSchema.nullish(),
});
export type EvidenceUploadFields = z.infer<typeof EvidenceUploadFieldsSchema>;

/** POST /cases/{caseNumber}/evidence/link — https only. */
export const EvidenceLinkCreateRequestSchema = z.object({
  url: HttpsUrlSchema,
  title: requiredText(1, LIMITS.EVIDENCE_TITLE_MAX),
  description: optionalText(LIMITS.EVIDENCE_DESCRIPTION_MAX),
  report_id: UuidSchema.nullish(),
  overwatch_session_id: UuidSchema.nullish(),
});
export type EvidenceLinkCreateRequest = z.infer<typeof EvidenceLinkCreateRequestSchema>;

/** Non-file multipart fields of POST /evidence/{id}/supersede (new object, old one kept). */
export const EvidenceSupersedeFieldsSchema = z.object({
  title: requiredText(1, LIMITS.EVIDENCE_TITLE_MAX).optional(),
  description: optionalText(LIMITS.EVIDENCE_DESCRIPTION_MAX),
  reason: requiredText(LIMITS.REVOKE_REASON_MIN, LIMITS.REVOKE_REASON_MAX),
});
export type EvidenceSupersedeFields = z.infer<typeof EvidenceSupersedeFieldsSchema>;

/** POST /evidence/{id}/reviews (evidence:review). */
export const EvidenceReviewRequestSchema = EvidenceAssessmentSchema.extend({
  comment: requiredText(LIMITS.REVIEW_COMMENT_MIN, LIMITS.REVIEW_COMMENT_MAX),
});
export type EvidenceReviewRequest = z.infer<typeof EvidenceReviewRequestSchema>;

/** POST /evidence/{id}/ticket — 60 s download ticket for <video>/<a>. */
export const EvidenceTicketResponseSchema = z.object({
  ticket: z.string().min(1),
  url: z.string().min(1),
  expires_at: IsoDateTimeSchema,
});
export type EvidenceTicketResponse = z.infer<typeof EvidenceTicketResponseSchema>;

export const EvidenceContentQuerySchema = z.object({
  ticket: z.string().min(1).max(2048).optional(),
});
export type EvidenceContentQuery = z.infer<typeof EvidenceContentQuerySchema>;

// ---------------------------------------------------------------------------
// Proof API — GET /evidence/proof (§10.3)
// ---------------------------------------------------------------------------

export const ProofCodeSchema = z.string().regex(PROOF_CODE_REGEX, 'Invalid proof code');

/** ISO date-time or unix milliseconds → epoch milliseconds. */
export const ProofTimestampSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value, ctx): number => {
    const epochMs = TIMESTAMP_MS_REGEX.test(value)
      ? Number(value)
      : IsoDateTimeSchema.safeParse(value).success
        ? Date.parse(value)
        : Number.NaN;
    if (!Number.isSafeInteger(epochMs) || epochMs < 0) {
      ctx.addIssue({ code: 'custom', message: 'timestamp must be an ISO date-time or unix milliseconds' });
      return z.NEVER;
    }
    return epochMs;
  });

/** Accepts `7k4x92`, `7K4-X92`, … → canonical `XXX-XXX`. */
export const ProofCodeInputSchema = z
  .string()
  .max(16)
  .transform((value, ctx): string => {
    const code = normalizeProofCode(value);
    if (code === null) {
      ctx.addIssue({ code: 'custom', message: 'Invalid proof code' });
      return z.NEVER;
    }
    return code;
  });

export const ProofQuerySchema = z.object({
  server_id: ServerIdSchema,
  player_id: UserIdStringSchema,
  spectator_id: UserIdStringSchema,
  timestamp: ProofTimestampSchema,
  /** Required for callers without proof:view_code (enforced by the backend). */
  code: ProofCodeInputSchema.optional(),
  session_id: UuidSchema.optional(),
});
export type ProofQuery = z.infer<typeof ProofQuerySchema>;
export type ProofQueryInput = z.input<typeof ProofQuerySchema>;

export const ProofTimestampWindowSchema = z.object({
  start: IsoDateTimeSchema,
  end: IsoDateTimeSchema,
});

/**
 * Proof result. `valid:false` never says which field was wrong. `code` (expected code for
 * window w) is only present for callers with proof:view_code. A valid proof establishes
 * session identity only, never guilt (R6).
 */
export const ProofResponseSchema = z.object({
  valid: z.boolean(),
  server_id: ServerIdSchema,
  player_id: UserIdStringSchema,
  spectator_id: UserIdStringSchema,
  /** Only when valid. */
  session_id: UuidSchema.optional(),
  timestamp_window: ProofTimestampWindowSchema,
  window_offset: z.union([z.literal(-1), z.literal(0), z.literal(1)]).optional(),
  code: ProofCodeSchema.optional(),
});
export type ProofResponse = z.infer<typeof ProofResponseSchema>;
