/**
 * zod building blocks for environment variables. Env values are strings; empty strings are
 * treated as "unset" (normalizeEnv) so `FOO=` in a .env file falls back to the default.
 */
import { z } from 'zod';

export type RawEnv = Record<string, string | undefined>;

/** Trims every value and drops empty ones. */
export function normalizeEnv(env: RawEnv): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') continue;
    const trimmed = value.trim();
    if (trimmed !== '') out[key] = trimmed;
  }
  return out;
}

const INTEGER = /^-?\d+$/;

/** Decimal integer within [min, max]. */
export function envInt(defaultValue: number, min: number, max: number) {
  return z
    .string()
    .regex(INTEGER, 'must be an integer')
    .transform(Number)
    .pipe(z.number().int().min(min).max(max))
    .default(defaultValue);
}

/** Optional decimal integer within [min, max] (undefined when unset). */
export function envOptionalInt(min: number, max: number) {
  return z.string().regex(INTEGER, 'must be an integer').transform(Number).pipe(z.number().int().min(min).max(max)).optional();
}

/** true/false/1/0/yes/no/on/off (case-insensitive). */
export function envBool(defaultValue: boolean) {
  return z.stringbool({ truthy: ['true', '1', 'yes', 'on'], falsy: ['false', '0', 'no', 'off'] }).default(defaultValue);
}

/** Optional boolean (undefined when unset, so the caller can pick an env-dependent default). */
export function envOptionalBool() {
  return z.stringbool({ truthy: ['true', '1', 'yes', 'on'], falsy: ['false', '0', 'no', 'off'] }).optional();
}

/** Comma-separated list (trimmed, empty entries dropped). */
export function splitList(value: string): string[] {
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/** Comma-separated list of enum values, deduplicated in order. */
export function envEnumList<const T extends readonly [string, ...string[]]>(values: T, defaultValue: readonly T[number][]) {
  const member = z.enum(values);
  return z
    .string()
    .transform((value, ctx) => {
      const out: T[number][] = [];
      for (const entry of splitList(value.toLowerCase() === 'none' ? '' : value)) {
        const parsed = member.safeParse(entry);
        if (!parsed.success) {
          ctx.addIssue({ code: 'custom', message: `unknown value "${entry}" (allowed: ${values.join(', ')})` });
          return z.NEVER;
        }
        if (!out.includes(parsed.data)) out.push(parsed.data);
      }
      return out;
    })
    .default([...defaultValue]);
}

/** http(s) URL. */
export function envUrl(protocols: readonly string[] = ['http:', 'https:']) {
  return z.string().refine((value) => {
    try {
      return protocols.includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, `must be a URL (${protocols.join(', ')})`);
}
