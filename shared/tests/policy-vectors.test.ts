import { describe, expect, it } from 'vitest';
import {
  evaluatePolicy,
  POLICY_ACTIONS,
  POLICY_REASON_CODES,
  POLICY_SIGNALS,
  PolicyDecisionSchema,
  PolicyEvaluationInputSchema,
  ServerPolicySchema,
  type EvaluablePolicy,
} from '../src';
import { loadPolicyVectors } from './helpers/vectors';

const vectors = loadPolicyVectors();

describe('policy.json', () => {
  it('has at least 30 uniquely named cases', () => {
    expect(vectors.cases.length).toBeGreaterThanOrEqual(30);
    expect(new Set(vectors.cases.map((c) => c.name)).size).toBe(vectors.cases.length);
  });

  it('covers every signal, every winning action and every reason code', () => {
    const signals = new Set(vectors.cases.flatMap((c) => c.policy.rules.map((r) => r.signal)));
    for (const signal of POLICY_SIGNALS) expect(signals).toContain(signal);
    const actions = new Set(vectors.cases.map((c) => c.expected.action));
    for (const action of POLICY_ACTIONS) expect(actions).toContain(action);
    const reasons = new Set(
      vectors.cases.flatMap((c) => [...c.expected_decision.applied, ...c.expected_decision.bypassed].map((o) => o.reason_code)),
    );
    for (const reason of POLICY_REASON_CODES) expect(reasons).toContain(reason);
  });

  it.each(vectors.cases.map((c) => [c.name, c] as const))('%s', (_name, vector) => {
    expect(PolicyEvaluationInputSchema.safeParse(vector.input).success).toBe(true);
    expect(ServerPolicySchema.safeParse(vector.policy).success).toBe(vector.schema_valid);

    const decision = evaluatePolicy(vector.input, vector.policy as unknown as EvaluablePolicy, vector.context);
    expect(decision).toEqual(vector.expected_decision);
    expect(PolicyDecisionSchema.safeParse(decision).success).toBe(true);
    expect({
      action: decision.action,
      applied_rule_ids: decision.applied.map((o) => o.rule_id),
      bypassed_rule_ids: decision.bypassed.map((o) => o.rule_id),
      notify_admins: decision.notify_admins,
      message: decision.message,
      ban_duration_minutes: decision.ban_duration_minutes,
    }).toEqual(vector.expected);
  });

  it('schema-valid vector policies evaluate identically after zod parsing', () => {
    for (const vector of vectors.cases.filter((c) => c.schema_valid)) {
      const parsed = ServerPolicySchema.parse(vector.policy);
      expect(evaluatePolicy(vector.input, parsed, vector.context), vector.name).toEqual(vector.expected_decision);
    }
  });
});
