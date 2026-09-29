/**
 * Server policy model (ARCHITECTURE §7.1) and the policy engine's input/output (§7.2).
 *
 * Rules are a discriminated union on `signal`. Each rule carries only the condition fields
 * of its signal; condition fields of other signals must be absent or null (anything else is
 * rejected). Array order of `rules` is the evaluation order (DB `sort_order`).
 */
import { z } from 'zod';
import { LIMITS } from '../constants';
import {
  AltConfidenceSchema,
  BackendUnavailableActionSchema,
  BypassTypeSchema,
  BYPASS_TYPES,
  GlobalStatusSchema,
  GLOBAL_STATUSES,
  PolicyActionSchema,
  PolicyReasonCodeSchema,
  PolicySignalSchema,
  VpnConfidenceSchema,
  type PolicyAction,
  type PolicySignal,
} from '../enums';
import { CaseNumberSchema, HttpUrlSchema, IsoDateTimeSchema, ServerIdSchema, UserRefSchema, UuidSchema } from './common';

// ---------------------------------------------------------------------------
// Rule condition fields
// ---------------------------------------------------------------------------

export const POLICY_CONDITION_FIELDS_BY_SIGNAL = Object.freeze({
  global_verdict: Object.freeze(['statuses', 'min_confirmed_servers'] as const),
  account_age: Object.freeze(['max_account_age_days', 'match_unknown_age'] as const),
  vpn: Object.freeze(['min_vpn_confidence'] as const),
  alt_account: Object.freeze(['min_alt_confidence', 'require_linked_confirmed_case'] as const),
  open_reports: Object.freeze(['min_open_reports'] as const),
} as const satisfies Record<PolicySignal, readonly string[]>);

export type PolicyConditionField = (typeof POLICY_CONDITION_FIELDS_BY_SIGNAL)[PolicySignal][number];
export const POLICY_CONDITION_FIELDS: readonly PolicyConditionField[] = Object.freeze(
  Object.values(POLICY_CONDITION_FIELDS_BY_SIGNAL).flat(),
);

/** Thresholds exclude values that would match every player (e.g. vpn ≥ not_detected). */
export const PolicyMinVpnConfidenceSchema = z.enum(['possible', 'likely', 'confirmed']);
export const PolicyMinAltConfidenceSchema = z.enum(['low', 'medium', 'high']);

const statusesSchema = z
  .array(GlobalStatusSchema)
  .min(1)
  .max(GLOBAL_STATUSES.length)
  .refine((statuses) => new Set(statuses).size === statuses.length, 'Duplicate statuses');
const minConfirmedServersSchema = z
  .number()
  .int()
  .min(0)
  .max(LIMITS.POLICY_MAX_CONFIRMED_SERVERS)
  .nullable()
  .default(null);
const maxAccountAgeDaysSchema = z.number().int().min(1).max(LIMITS.POLICY_MAX_ACCOUNT_AGE_DAYS);
const minOpenReportsSchema = z.number().int().min(1).max(LIMITS.POLICY_MAX_OPEN_REPORTS);
/** A condition field of another signal: only absent or null is accepted. */
const absent = z.null().optional();

export const PolicyRuleIdSchema = z.string().min(1).max(LIMITS.POLICY_RULE_ID_MAX);
export const PolicyMessageSchema = z.string().trim().max(LIMITS.POLICY_MESSAGE_MAX).nullable().default(null);
/** BAN only; 0 = permanent. */
export const BanDurationMinutesSchema = z
  .number()
  .int()
  .min(0)
  .max(LIMITS.POLICY_MAX_BAN_DURATION_MINUTES)
  .nullable()
  .default(null);

const ruleBaseShape = {
  id: PolicyRuleIdSchema,
  enabled: z.boolean().default(true),
  action: PolicyActionSchema,
  message: PolicyMessageSchema,
  ban_duration_minutes: BanDurationMinutesSchema,
};

export const GlobalVerdictRuleSchema = z.object({
  ...ruleBaseShape,
  signal: z.literal('global_verdict'),
  statuses: statusesSchema,
  min_confirmed_servers: minConfirmedServersSchema,
  max_account_age_days: absent,
  match_unknown_age: absent,
  min_vpn_confidence: absent,
  min_alt_confidence: absent,
  require_linked_confirmed_case: absent,
  min_open_reports: absent,
});

export const AccountAgeRuleSchema = z.object({
  ...ruleBaseShape,
  signal: z.literal('account_age'),
  /** Matches when days < max_account_age_days. */
  max_account_age_days: maxAccountAgeDaysSchema,
  match_unknown_age: z.boolean().default(false),
  statuses: absent,
  min_confirmed_servers: absent,
  min_vpn_confidence: absent,
  min_alt_confidence: absent,
  require_linked_confirmed_case: absent,
  min_open_reports: absent,
});

export const VpnRuleSchema = z.object({
  ...ruleBaseShape,
  signal: z.literal('vpn'),
  min_vpn_confidence: PolicyMinVpnConfidenceSchema,
  statuses: absent,
  min_confirmed_servers: absent,
  max_account_age_days: absent,
  match_unknown_age: absent,
  min_alt_confidence: absent,
  require_linked_confirmed_case: absent,
  min_open_reports: absent,
});

export const AltAccountRuleSchema = z.object({
  ...ruleBaseShape,
  signal: z.literal('alt_account'),
  min_alt_confidence: PolicyMinAltConfidenceSchema,
  require_linked_confirmed_case: z.boolean().default(false),
  statuses: absent,
  min_confirmed_servers: absent,
  max_account_age_days: absent,
  match_unknown_age: absent,
  min_vpn_confidence: absent,
  min_open_reports: absent,
});

export const OpenReportsRuleSchema = z.object({
  ...ruleBaseShape,
  signal: z.literal('open_reports'),
  min_open_reports: minOpenReportsSchema,
  statuses: absent,
  min_confirmed_servers: absent,
  max_account_age_days: absent,
  match_unknown_age: absent,
  min_vpn_confidence: absent,
  min_alt_confidence: absent,
  require_linked_confirmed_case: absent,
});

function checkBanDuration(
  rule: { action: PolicyAction; ban_duration_minutes: number | null },
  ctx: z.RefinementCtx,
): void {
  if (rule.action !== 'ban' && rule.ban_duration_minutes !== null) {
    ctx.addIssue({
      code: 'custom',
      message: 'ban_duration_minutes is only allowed for ban rules',
      path: ['ban_duration_minutes'],
    });
  }
}

/** A stored policy rule (with id). */
export const PolicyRuleSchema = z
  .discriminatedUnion('signal', [
    GlobalVerdictRuleSchema,
    AccountAgeRuleSchema,
    VpnRuleSchema,
    AltAccountRuleSchema,
    OpenReportsRuleSchema,
  ])
  .superRefine(checkBanDuration);
export type PolicyRule = z.infer<typeof PolicyRuleSchema>;
export type GlobalVerdictRule = z.infer<typeof GlobalVerdictRuleSchema>;
export type AccountAgeRule = z.infer<typeof AccountAgeRuleSchema>;
export type VpnRule = z.infer<typeof VpnRuleSchema>;
export type AltAccountRule = z.infer<typeof AltAccountRuleSchema>;
export type OpenReportsRule = z.infer<typeof OpenReportsRuleSchema>;

/** A rule in a policy update (ids are assigned by the backend; sent ids are ignored). */
export const PolicyRuleInputSchema = z
  .discriminatedUnion('signal', [
    GlobalVerdictRuleSchema.omit({ id: true }),
    AccountAgeRuleSchema.omit({ id: true }),
    VpnRuleSchema.omit({ id: true }),
    AltAccountRuleSchema.omit({ id: true }),
    OpenReportsRuleSchema.omit({ id: true }),
  ])
  .superRefine(checkBanDuration);
export type PolicyRuleInput = z.infer<typeof PolicyRuleInputSchema>;

// ---------------------------------------------------------------------------
// Policies
// ---------------------------------------------------------------------------

const policySettingsShape = {
  /** Only allow | admin_notify | kick. */
  backend_unavailable_action: BackendUnavailableActionSchema.default('allow'),
  notify_on_enforcement: z.boolean().default(true),
  honor_global_bypasses: z.boolean().default(false),
  whitelist_url: HttpUrlSchema.nullable().default(null),
};

function checkUniqueRuleIds(policy: { rules: ReadonlyArray<{ id: string }> }, ctx: z.RefinementCtx): void {
  const seen = new Set<string>();
  policy.rules.forEach((rule, index) => {
    if (seen.has(rule.id)) {
      ctx.addIssue({ code: 'custom', message: 'Duplicate rule id', path: ['rules', index, 'id'] });
    }
    seen.add(rule.id);
  });
}

const rulesSchema = z.array(PolicyRuleSchema).max(LIMITS.POLICY_RULES_MAX);

/** Policy as consumed by the plugin (GET /servers/policy, plugin `local_policy`). */
export const ServerPolicySchema = z
  .object({
    version: z.number().int().min(1),
    ...policySettingsShape,
    rules: rulesSchema,
  })
  .superRefine(checkUniqueRuleIds);
export type ServerPolicy = z.infer<typeof ServerPolicySchema>;

/** GET /servers/{id}/policy (web). */
export const ServerPolicyViewSchema = z
  .object({
    id: UuidSchema,
    server_id: ServerIdSchema,
    version: z.number().int().min(1),
    is_active: z.boolean(),
    ...policySettingsShape,
    rules: rulesSchema,
    created_at: IsoDateTimeSchema,
    created_by: UserRefSchema.nullable(),
  })
  .superRefine(checkUniqueRuleIds);
export type ServerPolicyView = z.infer<typeof ServerPolicyViewSchema>;

/** PUT /servers/{id}/policy — saves a new version (audit POLICY_UPDATED). */
export const ServerPolicyUpdateRequestSchema = z.object({
  ...policySettingsShape,
  rules: z.array(PolicyRuleInputSchema).max(LIMITS.POLICY_RULES_MAX),
  /** Optional optimistic concurrency: reject with CONFLICT if the active version differs. */
  base_version: z.number().int().min(1).optional(),
});
export type ServerPolicyUpdateRequest = z.infer<typeof ServerPolicyUpdateRequestSchema>;
export type ServerPolicyUpdateRequestInput = z.input<typeof ServerPolicyUpdateRequestSchema>;

// ---------------------------------------------------------------------------
// Engine input / output (§7.2)
// ---------------------------------------------------------------------------

/**
 * The subset of PlayerCheckResponse the policy engine reads. A full PlayerCheckResponse is
 * assignable to it (unknown keys are stripped when parsed).
 */
export const PolicyEvaluationInputSchema = z.object({
  global_status: GlobalStatusSchema,
  case_id: CaseNumberSchema.nullable(),
  confirmed_servers: z.number().int().min(0),
  open_reports: z.number().int().min(0),
  account_age: z.object({ days: z.number().int().min(0).nullable() }),
  vpn: z.object({ confidence: VpnConfidenceSchema }),
  alt_account: z.object({
    possible: z.boolean(),
    confidence: AltConfidenceSchema,
    linked_confirmed_cases: z.array(CaseNumberSchema).max(100),
  }),
  bypass: z.object({ types: z.array(BypassTypeSchema).max(BYPASS_TYPES.length) }),
});
export type PolicyEvaluationInput = z.infer<typeof PolicyEvaluationInputSchema>;

export const PolicyRuleOutcomeSchema = z.object({
  rule_id: PolicyRuleIdSchema,
  signal: PolicySignalSchema,
  action: PolicyActionSchema,
  reason_code: PolicyReasonCodeSchema,
});
export type PolicyRuleOutcome = z.infer<typeof PolicyRuleOutcomeSchema>;

export const PolicyDecisionSchema = z.object({
  action: PolicyActionSchema,
  applied: z.array(PolicyRuleOutcomeSchema),
  bypassed: z.array(PolicyRuleOutcomeSchema),
  notify_admins: z.boolean(),
  message: z.string().nullable(),
  /** Set only when action is ban (0 = permanent). */
  ban_duration_minutes: z.number().int().min(0).nullable(),
});
export type PolicyDecision = z.infer<typeof PolicyDecisionSchema>;

/** Unsaved policy for previews: settings + rules with client-side ids. */
export const PolicyDraftSchema = z
  .object({
    ...policySettingsShape,
    rules: rulesSchema,
  })
  .superRefine(checkUniqueRuleIds);
export type PolicyDraft = z.infer<typeof PolicyDraftSchema>;

/** POST /servers/{id}/policy/preview — evaluates `policy` (default: active policy) against `input`. */
export const PolicyPreviewRequestSchema = z.object({
  input: PolicyEvaluationInputSchema,
  policy: PolicyDraftSchema.optional(),
});
export type PolicyPreviewRequest = z.infer<typeof PolicyPreviewRequestSchema>;

export const PolicyPreviewResponseSchema = z.object({
  decision: PolicyDecisionSchema,
  /** Version of the evaluated stored policy; null when a draft was evaluated. */
  policy_version: z.number().int().min(1).nullable(),
});
export type PolicyPreviewResponse = z.infer<typeof PolicyPreviewResponseSchema>;
