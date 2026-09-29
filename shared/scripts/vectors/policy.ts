/**
 * Builds shared/test-vectors/policy.json from the hand-written cases in policy-cases.ts.
 */
import { isDeepStrictEqual } from 'node:util';
import { buildDefaultPolicyRules } from '../../src/policy/defaults';
import { evaluatePolicy, type EvaluablePolicy } from '../../src/policy/engine';
import { ServerPolicySchema } from '../../src/schemas/policy';
import { BASE_POLICY, buildInput, DEFAULT_RULES, POLICY_CASES } from './policy-cases';
import type { PolicyVectorCase, PolicyVectorExpected, PolicyVectors } from './types';

export function buildPolicyVectors(): PolicyVectors {
  if (!isDeepStrictEqual(DEFAULT_RULES, buildDefaultPolicyRules())) {
    throw new Error('policy vectors: DEFAULT_RULES differ from buildDefaultPolicyRules()');
  }
  const names = new Set<string>();
  const cases: PolicyVectorCase[] = POLICY_CASES.map((spec) => {
    if (names.has(spec.name)) throw new Error(`policy vectors: duplicate case name ${spec.name}`);
    names.add(spec.name);

    const policy = { ...BASE_POLICY, ...spec.policy, rules: spec.rules };
    const input = buildInput(spec.input);
    const context = spec.context ?? {};
    const schemaValid = spec.schema_valid ?? true;

    if (ServerPolicySchema.safeParse(policy).success !== schemaValid) {
      throw new Error(`policy vectors: ${spec.name} schema validity is not ${schemaValid}`);
    }

    // Vector policies may intentionally contain unknown signals/actions (forward compatibility).
    const decision = evaluatePolicy(input, policy as unknown as EvaluablePolicy, context);
    const actual: PolicyVectorExpected = {
      action: decision.action,
      applied_rule_ids: decision.applied.map((outcome) => outcome.rule_id),
      bypassed_rule_ids: decision.bypassed.map((outcome) => outcome.rule_id),
      notify_admins: decision.notify_admins,
      message: decision.message,
      ban_duration_minutes: decision.ban_duration_minutes,
    };
    if (!isDeepStrictEqual(actual, spec.expected)) {
      throw new Error(
        `policy vectors: ${spec.name} expected ${JSON.stringify(spec.expected)} but engine returned ${JSON.stringify(actual)}`,
      );
    }
    return {
      name: spec.name,
      description: spec.description,
      schema_valid: schemaValid,
      policy,
      input,
      context,
      expected: spec.expected,
      expected_decision: decision,
    };
  });

  return {
    version: '1',
    description:
      'Policy engine vectors (ARCHITECTURE §7.2). Evaluate `policy` against `input` with `context`; the result must equal `expected_decision` (and therefore `expected`).',
    cases,
  };
}
