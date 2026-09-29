/**
 * Web player pages (§13 "Players", Requirements §24). The public view is intentionally
 * limited; the staff view adds signals, links, sightings and bypasses — never raw IPs or
 * network hashes.
 */
import { z } from 'zod';
import {
  AccountAgeSourceSchema,
  AltConfidenceSchema,
  AltSignalSchema,
  AppealStatusSchema,
  CaseStatusSchema,
  CaseVerdictSchema,
  GlobalStatusSchema,
  PlayerIdTypeSchema,
  PlayerSignalTypeSchema,
  VpnConfidenceSchema,
} from '../enums';
import { BypassViewSchema } from './bypasses';
import {
  CaseNumberSchema,
  IsoDateTimeSchema,
  paginated,
  paginationQueryShape,
  PlayerSummarySchema,
  SearchQuerySchema,
  ServerRefSchema,
  UserIdStringSchema,
  UserRefSchema,
  UuidSchema,
} from './common';
import { ReportViewSchema } from './reports';

export const PlayerParamsSchema = z.object({ userId: UserIdStringSchema });
export type PlayerParams = z.infer<typeof PlayerParamsSchema>;

// ---------------------------------------------------------------------------
// Search (player:view_staff)
// ---------------------------------------------------------------------------

export const PlayerSearchQuerySchema = z.object({
  ...paginationQueryShape,
  q: SearchQuerySchema.optional(),
  type: PlayerIdTypeSchema.optional(),
  global_status: GlobalStatusSchema.optional(),
});
export type PlayerSearchQuery = z.infer<typeof PlayerSearchQuerySchema>;

export const PlayerSearchItemSchema = PlayerSummarySchema.extend({
  global_status: GlobalStatusSchema,
  case_count: z.number().int().min(0),
  open_case_count: z.number().int().min(0),
  first_seen_at: IsoDateTimeSchema.nullable(),
  last_seen_at: IsoDateTimeSchema.nullable(),
});
export type PlayerSearchItem = z.infer<typeof PlayerSearchItemSchema>;

export const PlayerSearchResponseSchema = paginated(PlayerSearchItemSchema);
export type PlayerSearchResponse = z.infer<typeof PlayerSearchResponseSchema>;

// ---------------------------------------------------------------------------
// Public view
// ---------------------------------------------------------------------------

export const PlayerPublicCaseSchema = z.object({
  case_number: CaseNumberSchema,
  verdict: CaseVerdictSchema,
  status: CaseStatusSchema,
  public_summary: z.string().nullable(),
  report_count: z.number().int().min(0),
  confirmed_servers: z.number().int().min(0),
  /** Status of the latest appeal, if any. */
  appeal_status: AppealStatusSchema.nullable(),
  created_at: IsoDateTimeSchema,
  updated_at: IsoDateTimeSchema,
});
export type PlayerPublicCase = z.infer<typeof PlayerPublicCaseSchema>;

const publicPlayerShape = {
  user_id: UserIdStringSchema,
  type: PlayerIdTypeSchema,
  id: z.string(),
  display_name: z.string().nullable(),
  first_seen_at: IsoDateTimeSchema.nullable(),
};

export const PlayerPublicViewSchema = z.object({
  view: z.literal('public'),
  player: z.object(publicPlayerShape),
  global_status: GlobalStatusSchema,
  /** Case that produced global_status. */
  case_id: CaseNumberSchema.nullable(),
  cases: z.array(PlayerPublicCaseSchema),
  /** Non-rejected reports. */
  reports: z.number().int().min(0),
  confirmed_servers: z.number().int().min(0),
});
export type PlayerPublicView = z.infer<typeof PlayerPublicViewSchema>;

// ---------------------------------------------------------------------------
// Staff view (player:view_staff)
// ---------------------------------------------------------------------------

export const PlayerStaffCaseSchema = PlayerPublicCaseSchema.extend({
  /** Internal case summary. */
  reason: z.string(),
  open_report_count: z.number().int().min(0),
  evidence_count: z.number().int().min(0),
});
export type PlayerStaffCase = z.infer<typeof PlayerStaffCaseSchema>;

export const PlayerSignalViewSchema = z.object({
  id: UuidSchema,
  signal: PlayerSignalTypeSchema,
  confidence: z.union([VpnConfidenceSchema, AltConfidenceSchema]).nullable(),
  source: z.string(),
  /** e.g. AltSignal values — never raw IPs or network hashes. */
  detail_codes: z.array(z.string()),
  server: ServerRefSchema.nullable(),
  created_at: IsoDateTimeSchema,
  expires_at: IsoDateTimeSchema.nullable(),
});
export type PlayerSignalView = z.infer<typeof PlayerSignalViewSchema>;

/** Possible alt link (signal only, R5). */
export const PlayerLinkViewSchema = z.object({
  linked_player: PlayerSummarySchema,
  signal: AltSignalSchema,
  first_detected_at: IsoDateTimeSchema,
  last_detected_at: IsoDateTimeSchema,
  occurrences: z.number().int().min(1),
  linked_confirmed_cases: z.array(CaseNumberSchema),
});
export type PlayerLinkView = z.infer<typeof PlayerLinkViewSchema>;

export const PlayerSightingViewSchema = z.object({
  server: ServerRefSchema,
  first_seen_at: IsoDateTimeSchema,
  last_seen_at: IsoDateTimeSchema,
  join_count: z.number().int().min(0),
});
export type PlayerSightingView = z.infer<typeof PlayerSightingViewSchema>;

export const PlayerStaffViewSchema = z.object({
  view: z.literal('staff'),
  player: z.object({
    ...publicPlayerShape,
    last_seen_at: IsoDateTimeSchema.nullable(),
    account_created_at: IsoDateTimeSchema.nullable(),
    account_age_days: z.number().int().min(0).nullable(),
    account_age_source: AccountAgeSourceSchema,
    account_age_checked_at: IsoDateTimeSchema.nullable(),
  }),
  global_status: GlobalStatusSchema,
  case_id: CaseNumberSchema.nullable(),
  cases: z.array(PlayerStaffCaseSchema),
  reports: z.number().int().min(0),
  confirmed_servers: z.number().int().min(0),
  linked_user: UserRefSchema.nullable(),
  recent_reports: z.array(ReportViewSchema),
  signals: z.array(PlayerSignalViewSchema),
  links: z.array(PlayerLinkViewSchema),
  sightings: z.array(PlayerSightingViewSchema),
  bypasses: z.array(BypassViewSchema),
});
export type PlayerStaffView = z.infer<typeof PlayerStaffViewSchema>;

/** GET /players/{userId}: public view for everyone, staff view with player:view_staff. */
export const PlayerViewResponseSchema = z.discriminatedUnion('view', [PlayerPublicViewSchema, PlayerStaffViewSchema]);
export type PlayerViewResponse = z.infer<typeof PlayerViewResponseSchema>;
