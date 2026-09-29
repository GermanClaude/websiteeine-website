import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import * as shared from '../src';
import {
  altConfidenceRank,
  AUDIT_ACTIONS,
  AuditActionSchema,
  BYPASS_TYPE_FOR_SIGNAL,
  BYPASS_TYPE_FOR_WHITELIST_REQUEST,
  BYPASS_TYPES,
  comparePolicyActions,
  globalStatusPriority,
  maxPolicyAction,
  PLUGIN_OVERWATCH_END_REASONS,
  POLICY_SIGNALS,
  PolicyAction,
  PolicyActionSchema,
  policyActionSeverity,
  roleRank,
  UserRole,
  UserRoleSchema,
  vpnConfidenceRank,
  WHITELIST_REQUEST_TYPES,
  type PolicyAction as PolicyActionType,
} from '../src';

/** Every exported `X_VALUES`-style tuple paired with its const object, found by naming convention. */
function enumPairs(): Array<[string, Record<string, string>]> {
  const exports = shared as unknown as Record<string, unknown>;
  const pairs: Array<[string, Record<string, string>]> = [];
  for (const [name, value] of Object.entries(exports)) {
    const schema = exports[`${name}Schema`] as { options?: unknown } | undefined;
    if (name === 'Permission') continue; // 'domain:action' strings, covered by permissions.test.ts
    if (typeof value === 'object' && value !== null && !Array.isArray(value) && Array.isArray(schema?.options)) {
      pairs.push([name, value as Record<string, string>]);
    }
  }
  return pairs;
}

describe('enum conventions', () => {
  const pairs = enumPairs();

  it('finds all §3 enums', () => {
    const names = pairs.map(([name]) => name);
    for (const expected of [
      'UserRole',
      'UserStatus',
      'ServerStatus',
      'ServerKeyStatus',
      'ServerMemberRole',
      'PlayerIdType',
      'GlobalStatus',
      'CaseVerdict',
      'CaseStatus',
      'ReportStatus',
      'ReporterType',
      'EvidenceType',
      'EvidenceStatus',
      'AppealStatus',
      'AppealDecision',
      'WhitelistRequestStatus',
      'WhitelistRequestType',
      'BypassType',
      'BypassScope',
      'VpnConfidence',
      'VpnType',
      'AltConfidence',
      'AltSignal',
      'AccountAgeSource',
      'PolicySignal',
      'PolicyAction',
      'ActorType',
      'OverwatchSessionStatus',
      'AuditAction',
    ]) {
      expect(names).toContain(expected);
    }
  });

  it.each(enumPairs())('%s: values are lowercase snake_case (AuditAction: upper-case names)', (name, obj) => {
    for (const [key, value] of Object.entries(obj)) {
      if (name === 'AuditAction' || name === 'ErrorCode') {
        expect(value).toBe(key);
        expect(value).toMatch(/^[A-Z0-9_]+$/);
      } else {
        expect(value).toMatch(/^[a-z][a-z0-9_]*$/);
        expect(key).toBe(value.toUpperCase());
      }
    }
  });

  it('schemas reject upper-case wire values', () => {
    expect(UserRoleSchema.safeParse('SUPER_ADMIN').success).toBe(false);
    expect(UserRoleSchema.safeParse(UserRole.SUPER_ADMIN).success).toBe(true);
    expect(PolicyActionSchema.safeParse('Kick').success).toBe(false);
    expect(AuditActionSchema.safeParse('report_created').success).toBe(false);
    expect(AuditActionSchema.safeParse('REPORT_CREATED').success).toBe(true);
  });

  it('contains the full §9.2 audit action list', () => {
    expect(AUDIT_ACTIONS).toHaveLength(61);
    expect(AUDIT_ACTIONS).toContain('BYPASS_CREATED');
    expect(AUDIT_ACTIONS).toContain('RETENTION_RUN');
    expect(new Set(AUDIT_ACTIONS).size).toBe(AUDIT_ACTIONS.length);
    // Cross-check against the architecture document when it is available (monorepo checkout).
    const doc = join(dirname(fileURLToPath(import.meta.url)), '../../docs/ARCHITECTURE.md');
    if (existsSync(doc)) {
      const match = /`(USER_REGISTERED[\s\S]*?RETENTION_RUN)`/.exec(readFileSync(doc, 'utf8'));
      const documented = (match?.[1] ?? '').split(',').map((name) => name.trim()).filter(Boolean);
      expect(new Set(AUDIT_ACTIONS)).toEqual(new Set(documented));
    }
  });

  it('plugin end reasons exclude the backend-only heartbeat_timeout', () => {
    expect(PLUGIN_OVERWATCH_END_REASONS).not.toContain('heartbeat_timeout');
    expect(PLUGIN_OVERWATCH_END_REASONS).toHaveLength(6);
  });
});

describe('ordinal helpers', () => {
  it('policy action severity 0–6', () => {
    const order: PolicyActionType[] = ['allow', 'admin_notify', 'warn', 'require_review', 'require_whitelist', 'kick', 'ban'];
    order.forEach((action, index) => expect(policyActionSeverity(action)).toBe(index));
    expect(comparePolicyActions('kick', 'ban')).toBeLessThan(0);
    expect(comparePolicyActions('ban', 'ban')).toBe(0);
    expect(comparePolicyActions('require_whitelist', 'require_review')).toBeGreaterThan(0);
    expect([...order].reverse().sort(comparePolicyActions)).toEqual(order);
  });

  it('maxPolicyAction', () => {
    expect(maxPolicyAction([])).toBe(PolicyAction.ALLOW);
    expect(maxPolicyAction(['warn', 'ban', 'kick'])).toBe('ban');
    expect(maxPolicyAction(new Set<PolicyActionType>(['admin_notify', 'require_review']))).toBe('require_review');
  });

  it('confidence, status and role ranks', () => {
    expect(['not_detected', 'possible', 'likely', 'confirmed'].map((c) => vpnConfidenceRank(c as never))).toEqual([0, 1, 2, 3]);
    expect(['none', 'low', 'medium', 'high'].map((c) => altConfidenceRank(c as never))).toEqual([0, 1, 2, 3]);
    expect(
      ['none', 'rejected', 'inconclusive', 'reported', 'under_review', 'confirmed'].map((s) => globalStatusPriority(s as never)),
    ).toEqual([0, 1, 2, 3, 4, 5]);
    expect(['player', 'server_admin', 'reviewer', 'moderator', 'admin', 'super_admin'].map((r) => roleRank(r as never))).toEqual([
      0, 1, 2, 3, 4, 5,
    ]);
  });

  it('unknown values rank -1', () => {
    expect(policyActionSeverity('nuke' as never)).toBe(-1);
    expect(vpnConfidenceRank('extreme' as never)).toBe(-1);
    expect(roleRank('root' as never)).toBe(-1);
  });
});

describe('mappings', () => {
  it('every signal has an exempting bypass type (§7.2 step 2)', () => {
    expect(Object.keys(BYPASS_TYPE_FOR_SIGNAL).sort()).toEqual([...POLICY_SIGNALS].sort());
    expect(BYPASS_TYPE_FOR_SIGNAL).toEqual({
      global_verdict: 'verdict_override',
      account_age: 'account_age_whitelist',
      vpn: 'vpn_whitelist',
      alt_account: 'alt_account_whitelist',
      open_reports: 'verdict_override',
    });
    for (const type of Object.values(BYPASS_TYPE_FOR_SIGNAL)) expect(BYPASS_TYPES).toContain(type);
  });

  it('whitelist request types map to bypass types', () => {
    expect(Object.keys(BYPASS_TYPE_FOR_WHITELIST_REQUEST).sort()).toEqual([...WHITELIST_REQUEST_TYPES].sort());
    expect(BYPASS_TYPE_FOR_WHITELIST_REQUEST.vpn_whitelist).toBe('vpn_whitelist');
    expect(BYPASS_TYPE_FOR_WHITELIST_REQUEST.account_age_whitelist).toBe('account_age_whitelist');
  });
});
