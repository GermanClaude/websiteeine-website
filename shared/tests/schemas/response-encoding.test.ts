/**
 * Response schemas are serialized by the backend with z.encode (fastify-type-provider-zod),
 * which throws on unidirectional transforms. This test walks every exported response/view
 * schema and asserts it contains no transform, then round-trips representative samples.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import * as shared from '../../src';

type AnyDef = { type: string; [key: string]: unknown };

function defOf(schema: unknown): AnyDef | null {
  const zod = (schema as { _zod?: { def?: AnyDef } } | null)?._zod;
  return zod?.def ?? null;
}

/** Returns the path of the first transform found in the schema tree, or null. */
function findTransform(schema: unknown, path: string, seen = new Set<unknown>()): string | null {
  const def = defOf(schema);
  if (def === null || seen.has(schema)) return null;
  seen.add(schema);
  if (def.type === 'transform') return path;
  const children: Array<[string, unknown]> = [];
  switch (def.type) {
    case 'object':
      for (const [key, value] of Object.entries((schema as { shape: Record<string, unknown> }).shape)) children.push([`${path}.${key}`, value]);
      break;
    case 'array':
      children.push([`${path}[]`, def.element]);
      break;
    case 'union':
      (def.options as unknown[]).forEach((option, index) => children.push([`${path}|${index}`, option]));
      break;
    case 'record':
      children.push([`${path}{key}`, def.keyType], [`${path}{value}`, def.valueType]);
      break;
    case 'pipe':
      children.push([`${path}>in`, def.in], [`${path}>out`, def.out]);
      break;
    case 'optional':
    case 'nullable':
    case 'default':
    case 'prefault':
    case 'readonly':
    case 'catch':
    case 'nonoptional':
      children.push([path, def.innerType]);
      break;
    default:
      break;
  }
  for (const [childPath, child] of children) {
    const found = findTransform(child, childPath, seen);
    if (found !== null) return found;
  }
  return null;
}

const responseSchemas = Object.entries(shared as unknown as Record<string, unknown>).filter(
  ([name, value]) => /(Response|View|Summary|Detail)Schema$/.test(name) && defOf(value) !== null,
);

describe('response schemas', () => {
  it('there are many response schemas to check', () => {
    expect(responseSchemas.length).toBeGreaterThan(40);
  });

  it.each(responseSchemas)('%s contains no transforms', (name, schema) => {
    expect(findTransform(schema, name)).toBeNull();
  });

  it('the walker does detect transforms', () => {
    expect(findTransform(z.object({ a: z.array(z.string().transform(Number)) }), 'x')).toBe('x.a[]>out');
  });

  it('representative responses survive z.encode', () => {
    const iso = '2026-09-29T15:42:20.000Z';
    const samples: Array<[z.ZodType, unknown]> = [
      [shared.ServerPolicySchema, shared.DEFAULT_POLICY],
      [
        shared.PolicyDecisionSchema,
        { action: 'kick', applied: [{ rule_id: 'a', signal: 'vpn', action: 'kick', reason_code: 'vpn_confidence' }], bypassed: [], notify_admins: true, message: 'x', ban_duration_minutes: null },
      ],
      [shared.TimeResponseSchema, { server_time: iso, epoch_ms: 1790000000000 }],
      [shared.AuditVerifyResponseSchema, { valid: true, checked_events: 4, first_broken_seq: null, failure: null, last_seq: 4, last_hash: 'a'.repeat(64), verified_at: iso }],
      [
        shared.DashboardResponseSchema,
        {
          counts: { open_cases: 1, cases_under_review: 0, pending_reports: null, pending_appeals: 0, evidence_awaiting_review: 2, pending_whitelist_requests: 0 },
          servers: [],
          recent_audit_events: [],
          generated_at: iso,
        },
      ],
      [shared.ErrorResponseSchema, shared.buildErrorResponse('INVALID_SIGNATURE', 'r')],
    ];
    for (const [schema, sample] of samples) {
      const result = z.safeEncode(schema, sample as never);
      expect(result.success).toBe(true);
    }
  });
});
