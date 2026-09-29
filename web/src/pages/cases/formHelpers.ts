/**
 * Small zod adapters for form inputs: HTML inputs yield '' for "not set", while the shared
 * request schemas expect `null`/`undefined` for optional ids. Extending a shared schema with
 * these keeps the validated output identical to the shared request type.
 */
import { ServerIdSchema, UuidSchema } from '@scpsl-trust/shared';
import { z } from 'zod';

/** '' → null, otherwise a valid `srv_…` server id. */
export const optionalServerIdInput = z
  .string()
  .trim()
  .transform((value): string | null => (value === '' ? null : value))
  .pipe(ServerIdSchema.nullable());

/** '' → null, otherwise a UUID. */
export const optionalUuidInput = z
  .string()
  .trim()
  .transform((value): string | null => (value === '' ? null : value))
  .pipe(UuidSchema.nullable());

/** '' → undefined (for optional query parameters). */
export const optionalStringInput = z
  .string()
  .trim()
  .transform((value): string | undefined => (value === '' ? undefined : value));

/** "12 / 500" style counter for textareas. */
export function lengthHint(value: string | null | undefined, max: number, min = 0): string {
  const length = value === null || value === undefined ? 0 : value.trim().length;
  return min > 0 ? `${length} / ${max} characters (at least ${min})` : `${length} / ${max} characters`;
}

/** Narrows a free-form filter value (query string) to a member of an enum tuple, else `undefined`. */
export function enumFilter<T extends string>(value: string | undefined, values: readonly T[]): T | undefined {
  return value !== undefined && (values as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** '' / undefined → undefined (for optional query parameters built from URL filters). */
export function emptyToUndefined(value: string | undefined): string | undefined {
  return value === undefined || value.trim() === '' ? undefined : value.trim();
}
