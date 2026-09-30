/**
 * Policy business logic (§4.3, §7): versioned saves (immutable rows), default policy
 * materialization on registration, and mapping DB rows to the shared wire model.
 */
import {
  AuditAction,
  buildDefaultPolicy,
  type PolicyRule,
  type PolicyRuleInput,
  type ServerPolicy,
  type ServerPolicyUpdateRequest,
  type ServerPolicyView,
  type UserRef,
} from '@scpsl-trust/shared';

import type { AuditActor } from '../audit';
import type { Deps } from '../../container';
import type { DbExecutor, DbTransaction, NewServerPolicyRule, ServerPolicyRow, ServerPolicyRuleRow } from '../../db';
import { withTransaction } from '../../db';
import { conflict } from '../../lib/errors';
import { generateUuid } from '../../lib/ids';
import {
  deactivatePolicy,
  findActivePolicy,
  findActivePolicyForUpdate,
  findPolicyRules,
  insertPolicy,
  insertPolicyRules,
  type PolicyWithRules,
} from './repository';

export type { PolicyWithRules } from './repository';

// ---------------------------------------------------------------------------
// Row ⇄ wire mapping
// ---------------------------------------------------------------------------

/** Maps a DB rule row to the shared discriminated-union rule (cross-signal fields null). */
export function toWireRule(row: ServerPolicyRuleRow): PolicyRule {
  const base = {
    id: row.id,
    enabled: row.enabled,
    message: row.message,
    ban_duration_minutes: row.ban_duration_minutes,
  };
  switch (row.signal) {
    case 'global_verdict':
      return {
        ...base,
        signal: 'global_verdict',
        action: row.action,
        statuses: row.statuses ?? [],
        min_confirmed_servers: row.min_confirmed_servers,
      };
    case 'account_age':
      return {
        ...base,
        signal: 'account_age',
        action: row.action,
        max_account_age_days: row.max_account_age_days ?? 1,
        match_unknown_age: row.match_unknown_age ?? false,
      };
    case 'vpn':
      return {
        ...base,
        signal: 'vpn',
        action: row.action,
        min_vpn_confidence: (row.min_vpn_confidence ?? 'likely') as 'possible' | 'likely' | 'confirmed',
      };
    case 'alt_account':
      return {
        ...base,
        signal: 'alt_account',
        action: row.action,
        min_alt_confidence: (row.min_alt_confidence ?? 'medium') as 'low' | 'medium' | 'high',
        require_linked_confirmed_case: row.require_linked_confirmed_case ?? false,
      };
    case 'open_reports':
      return {
        ...base,
        signal: 'open_reports',
        action: row.action,
        min_open_reports: row.min_open_reports ?? 1,
      };
  }
}

/** Plugin wire model (GET /servers/policy). */
export function toServerPolicyDto(data: PolicyWithRules): ServerPolicy {
  return {
    version: data.policy.version,
    backend_unavailable_action: data.policy.backend_unavailable_action,
    notify_on_enforcement: data.policy.notify_on_enforcement,
    honor_global_bypasses: data.policy.honor_global_bypasses,
    whitelist_url: data.policy.whitelist_url,
    rules: data.rules.map(toWireRule),
  };
}

/** Web view (GET /servers/{id}/policy). Dates are converted to ISO strings here. */
export function toServerPolicyView(
  data: PolicyWithRules,
  serverPublicId: string,
  createdBy: UserRef | null,
): ServerPolicyView {
  return {
    id: data.policy.id,
    server_id: serverPublicId,
    version: data.policy.version,
    is_active: data.policy.is_active,
    backend_unavailable_action: data.policy.backend_unavailable_action,
    notify_on_enforcement: data.policy.notify_on_enforcement,
    honor_global_bypasses: data.policy.honor_global_bypasses,
    whitelist_url: data.policy.whitelist_url,
    rules: data.rules.map(toWireRule),
    created_at: data.policy.created_at.toISOString(),
    created_by: createdBy,
  };
}

// ---------------------------------------------------------------------------
// Rule input → DB rows
// ---------------------------------------------------------------------------

function ruleToDbValues(rule: PolicyRuleInput | PolicyRule, policyId: string, sortOrder: number): NewServerPolicyRule {
  const r = rule as Partial<PolicyRule> & PolicyRuleInput;
  return {
    id: generateUuid(),
    policy_id: policyId,
    sort_order: sortOrder,
    enabled: r.enabled,
    signal: r.signal,
    action: r.action,
    statuses: r.signal === 'global_verdict' ? r.statuses : null,
    min_confirmed_servers: r.signal === 'global_verdict' ? (r.min_confirmed_servers ?? null) : null,
    max_account_age_days: r.signal === 'account_age' ? r.max_account_age_days : null,
    match_unknown_age: r.signal === 'account_age' ? r.match_unknown_age : null,
    min_vpn_confidence: r.signal === 'vpn' ? r.min_vpn_confidence : null,
    min_alt_confidence: r.signal === 'alt_account' ? r.min_alt_confidence : null,
    require_linked_confirmed_case: r.signal === 'alt_account' ? r.require_linked_confirmed_case : null,
    min_open_reports: r.signal === 'open_reports' ? r.min_open_reports : null,
    message: r.message ?? null,
    ban_duration_minutes: r.ban_duration_minutes ?? null,
  };
}

// ---------------------------------------------------------------------------
// Service operations
// ---------------------------------------------------------------------------

/**
 * Materializes the §7.4 default policy as version 1 for a server that has none yet.
 * Called inside the registration transaction. Returns the existing active policy when
 * one is already present (idempotent).
 */
export async function materializeDefaultPolicy(
  trx: DbExecutor,
  serverUuid: string,
  createdBy: string | null = null,
): Promise<PolicyWithRules> {
  const existing = await findActivePolicy(trx, serverUuid);
  if (existing !== undefined) {
    return { policy: existing, rules: await findPolicyRules(trx, existing.id) };
  }
  const defaults = buildDefaultPolicy(1);
  const policy = await insertPolicy(trx, {
    id: generateUuid(),
    server_id: serverUuid,
    version: 1,
    is_active: true,
    backend_unavailable_action: defaults.backend_unavailable_action,
    notify_on_enforcement: defaults.notify_on_enforcement,
    honor_global_bypasses: defaults.honor_global_bypasses,
    whitelist_url: defaults.whitelist_url,
    created_by: createdBy,
  });
  const rules = await insertPolicyRules(
    trx,
    defaults.rules.map((rule, index) => ruleToDbValues(rule, policy.id, index)),
  );
  return { policy, rules };
}

/**
 * Active policy of a server; materializes the default (version 1) when the server has
 * none yet (a registered server always has one, this is the defensive fallback).
 */
export async function getActivePolicy(deps: Pick<Deps, 'db'>, serverUuid: string): Promise<PolicyWithRules> {
  const active = await findActivePolicy(deps.db, serverUuid);
  if (active !== undefined) {
    return { policy: active, rules: await findPolicyRules(deps.db, active.id) };
  }
  return withTransaction(deps.db, (trx) => materializeDefaultPolicy(trx, serverUuid));
}

export interface SavePolicyContext {
  actor: AuditActor;
  request_id?: string | undefined;
}

/**
 * Saves a new policy version inside `trx`: rules copied from the input (array order =
 * sort_order), previous version deactivated, audit POLICY_UPDATED. Rows are immutable —
 * a save is always an insert. `base_version` mismatch → 409 CONFLICT.
 */
export async function savePolicyTx(
  deps: Pick<Deps, 'audit'>,
  trx: DbTransaction,
  serverUuid: string,
  input: ServerPolicyUpdateRequest,
  ctx: SavePolicyContext,
): Promise<PolicyWithRules> {
  const previous = await findActivePolicyForUpdate(trx, serverUuid);
  const fromVersion = previous?.version ?? 0;
  if (input.base_version !== undefined && input.base_version !== fromVersion) {
    throw conflict('The policy was changed by someone else', {
      active_version: fromVersion,
      base_version: input.base_version,
    });
  }
  if (previous !== undefined) await deactivatePolicy(trx, previous.id);
  const policy = await insertPolicy(trx, {
    id: generateUuid(),
    server_id: serverUuid,
    version: fromVersion + 1,
    is_active: true,
    backend_unavailable_action: input.backend_unavailable_action,
    notify_on_enforcement: input.notify_on_enforcement,
    honor_global_bypasses: input.honor_global_bypasses,
    whitelist_url: input.whitelist_url,
    created_by: ctx.actor.actor_type === 'user' ? ctx.actor.actor_id : null,
  });
  const rules = await insertPolicyRules(
    trx,
    input.rules.map((rule, index) => ruleToDbValues(rule, policy.id, index)),
  );
  await deps.audit.record(trx, {
    actor: ctx.actor,
    action: AuditAction.POLICY_UPDATED,
    target_type: 'server_policy',
    target_id: policy.id,
    server_id: serverUuid,
    metadata: { from_version: fromVersion, to_version: policy.version, rule_count: rules.length },
    ...(ctx.request_id !== undefined ? { request_id: ctx.request_id } : {}),
  });
  return { policy, rules };
}

/** savePolicyTx in its own transaction. */
export async function savePolicy(
  deps: Pick<Deps, 'db' | 'audit'>,
  serverUuid: string,
  input: ServerPolicyUpdateRequest,
  ctx: SavePolicyContext,
): Promise<PolicyWithRules> {
  return withTransaction(deps.db, (trx) => savePolicyTx(deps, trx, serverUuid, input, ctx));
}
