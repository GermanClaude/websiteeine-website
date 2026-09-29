/**
 * Plugin-facing player endpoints (signed, §6.1, §6.2, §6.5, §6.6):
 * /player/check, /player/bypass/check, /player/link, /server/reports.
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import {
  AccountAgeSourceSchema,
  AltConfidenceSchema,
  AltSignalSchema,
  BypassTypeSchema,
  BYPASS_TYPES,
  CaseStatusSchema,
  CaseVerdictSchema,
  GlobalStatusSchema,
  PlayerIdTypeSchema,
  VpnCheckErrorSchema,
  VpnConfidenceSchema,
  VpnTypeSchema,
} from '../enums';
import { BypassSummarySchema } from './bypasses';
import {
  CaseNumberSchema,
  IpAddressSchema,
  IsoDateTimeSchema,
  optionalText,
  PlayerRefSchema,
  requiredText,
  ServerIdSchema,
  UserIdStringSchema,
  UsernameSchema,
  UuidSchema,
} from './common';
import { LinkCodeSchema } from './users';

/** In-game nickname (plugin truncates to 64 characters). */
export const NicknameSchema = z.string().min(1).max(LIMITS.DISPLAY_NAME_MAX);

// ---------------------------------------------------------------------------
// POST /player/check
// ---------------------------------------------------------------------------

export const PlayerCheckRequestSchema = z.object({
  /** Optional; must match X-Server-Id. */
  server_id: ServerIdSchema.optional(),
  player: PlayerRefSchema,
  nickname: NicknameSchema.nullish(),
  /** Used transiently for VPN/alt analysis, never stored raw. */
  ip: IpAddressSchema.nullish(),
  /** Untrusted hint (source `server_reported`). */
  account_created_at: IsoDateTimeSchema.nullish(),
});
export type PlayerCheckRequest = z.infer<typeof PlayerCheckRequestSchema>;

export const PlayerCheckPlayerSchema = z.object({
  type: PlayerIdTypeSchema,
  id: z.string(),
  user_id: UserIdStringSchema,
  first_seen_at: IsoDateTimeSchema.nullable(),
});

export const PlayerCheckCaseSchema = z.object({
  case_id: CaseNumberSchema,
  verdict: CaseVerdictSchema,
  status: CaseStatusSchema,
  confirmed_servers: z.number().int().min(0),
});
export type PlayerCheckCase = z.infer<typeof PlayerCheckCaseSchema>;

export const PlayerCheckAccountAgeSchema = z.object({
  /** null when unknown. */
  days: z.number().int().min(0).nullable(),
  created_at: IsoDateTimeSchema.nullable(),
  source: AccountAgeSourceSchema,
});

export const PlayerCheckVpnSchema = z.object({
  detected: z.boolean(),
  confidence: VpnConfidenceSchema,
  type: VpnTypeSchema.nullable(),
  /** false when no ip was sent or every provider failed. */
  checked: z.boolean().optional(),
  error: VpnCheckErrorSchema.nullish(),
});

export const PlayerCheckBypassSchema = z.object({
  active: z.boolean(),
  /** Types of all active bypasses considered for this server. */
  types: z.array(BypassTypeSchema).max(BYPASS_TYPES.length),
  bypasses: z.array(BypassSummarySchema),
});

export const PlayerCheckAltAccountSchema = z.object({
  possible: z.boolean(),
  confidence: AltConfidenceSchema,
  signals: z.array(AltSignalSchema),
  /** Case numbers of confirmed cases of linked accounts (public information). */
  linked_confirmed_cases: z.array(CaseNumberSchema),
});

/** Pure information — deliberately contains no enforcement action (R1). */
export const PlayerCheckResponseSchema = z.object({
  player: PlayerCheckPlayerSchema,
  global_status: GlobalStatusSchema,
  case_id: CaseNumberSchema.nullable(),
  cases: z.array(PlayerCheckCaseSchema),
  reports: z.number().int().min(0),
  open_reports: z.number().int().min(0),
  confirmed_servers: z.number().int().min(0),
  independent_confirmed_servers: z.number().int().min(0),
  account_age: PlayerCheckAccountAgeSchema,
  vpn: PlayerCheckVpnSchema,
  bypass: PlayerCheckBypassSchema,
  alt_account: PlayerCheckAltAccountSchema,
  policy_version: z.number().int().min(1).nullable(),
  checked_at: IsoDateTimeSchema,
});
export type PlayerCheckResponse = z.infer<typeof PlayerCheckResponseSchema>;

// ---------------------------------------------------------------------------
// POST /player/bypass/check
// ---------------------------------------------------------------------------

export const BypassCheckRequestSchema = z.object({
  server_id: ServerIdSchema.optional(),
  player: PlayerRefSchema,
  ip: IpAddressSchema.nullish(),
  types: z
    .array(BypassTypeSchema)
    .max(BYPASS_TYPES.length)
    .refine((types) => new Set(types).size === types.length, 'Duplicate bypass types')
    .optional(),
});
export type BypassCheckRequest = z.infer<typeof BypassCheckRequestSchema>;

export const BypassCheckResponseSchema = z.object({
  vpn: z.boolean(),
  bypass: z.boolean(),
  bypass_type: BypassTypeSchema.nullable(),
  expires_at: IsoDateTimeSchema.nullable(),
  bypasses: z.array(BypassSummarySchema),
});
export type BypassCheckResponse = z.infer<typeof BypassCheckResponseSchema>;

// ---------------------------------------------------------------------------
// POST /player/link
// ---------------------------------------------------------------------------

export const PlayerLinkRequestSchema = z.object({
  server_id: ServerIdSchema.optional(),
  player: PlayerRefSchema,
  code: LinkCodeSchema,
});
export type PlayerLinkRequest = z.infer<typeof PlayerLinkRequestSchema>;

export const PlayerLinkResponseSchema = z.object({
  linked: z.literal(true),
  /** Web account name, shown to the player who typed the code. */
  username: UsernameSchema,
});
export type PlayerLinkResponse = z.infer<typeof PlayerLinkResponseSchema>;

// ---------------------------------------------------------------------------
// POST /server/reports (in-game report forwarded by the plugin)
// ---------------------------------------------------------------------------

const textEncoder = new TextEncoder();

export const LogExcerptSchema = z
  .string()
  .min(1)
  .refine(
    (value) => value.length <= LIMITS.LOG_EXCERPT_MAX_BYTES && textEncoder.encode(value).length <= LIMITS.LOG_EXCERPT_MAX_BYTES,
    `log_excerpt must not exceed ${LIMITS.LOG_EXCERPT_MAX_BYTES} bytes (UTF-8)`,
  );

export const ServerReportRequestSchema = z
  .object({
    server_id: ServerIdSchema.optional(),
    player: PlayerRefSchema,
    reporter: PlayerRefSchema.nullish(),
    reason: requiredText(LIMITS.REPORT_REASON_MIN, LIMITS.REPORT_REASON_MAX),
    description: optionalText(LIMITS.REPORT_DESCRIPTION_MAX),
    log_excerpt: LogExcerptSchema.nullish(),
  })
  .refine(
    (body) => !body.reporter || body.reporter.type !== body.player.type || body.reporter.id !== body.player.id,
    { message: 'A player cannot report themselves', path: ['reporter'] },
  );
export type ServerReportRequest = z.infer<typeof ServerReportRequestSchema>;

/** Also used by the web POST /reports. */
export const ReportCreateResponseSchema = z.object({
  report_id: UuidSchema,
  case_id: CaseNumberSchema,
});
export type ReportCreateResponse = z.infer<typeof ReportCreateResponseSchema>;
export const ServerReportResponseSchema = ReportCreateResponseSchema;
export type ServerReportResponse = ReportCreateResponse;
