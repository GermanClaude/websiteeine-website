/**
 * Small zod helpers for form inputs whose DOM value is a string but whose API type is a
 * number or an ISO timestamp. Used by the server, whitelist, appeal and admin forms.
 */
import { z } from 'zod';

export interface IntInputOptions {
  min: number;
  max: number;
  /** Empty input is an error instead of `null`. */
  required?: boolean;
  label?: string;
}

/** `'12'` → 12, `''` → null (or an error when required); rejects non-integers and out-of-range values. */
export function intInput({ min, max, required = false, label = 'Value' }: IntInputOptions) {
  return z
    .string()
    .trim()
    .transform((raw, ctx): number | null => {
      if (raw === '') {
        if (required) {
          ctx.addIssue({ code: 'custom', message: `${label} is required` });
          return z.NEVER;
        }
        return null;
      }
      const value = Number(raw);
      if (!Number.isInteger(value)) {
        ctx.addIssue({ code: 'custom', message: 'Enter a whole number' });
        return z.NEVER;
      }
      if (value < min || value > max) {
        ctx.addIssue({ code: 'custom', message: `Must be between ${min} and ${max}` });
        return z.NEVER;
      }
      return value;
    });
}

/** `datetime-local` value (`2026-09-29T15:42`, local time) → ISO string; `''` → null. */
export function localDateTimeToIso(value: string): string | null {
  if (value.trim() === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

/** Optional `datetime-local` input that must lie in the future. */
export function futureDateTimeInput(label = 'Date') {
  return z
    .string()
    .trim()
    .transform((raw, ctx): string | null => {
      if (raw === '') return null;
      const iso = localDateTimeToIso(raw);
      if (iso === null) {
        ctx.addIssue({ code: 'custom', message: `${label} is not a valid date` });
        return z.NEVER;
      }
      if (Date.parse(iso) <= Date.now()) {
        ctx.addIssue({ code: 'custom', message: `${label} must be in the future` });
        return z.NEVER;
      }
      return iso;
    });
}

/** Optional `datetime-local` input → ISO string (any point in time). */
export function dateTimeInput(label = 'Date') {
  return z
    .string()
    .trim()
    .transform((raw, ctx): string | null => {
      if (raw === '') return null;
      const iso = localDateTimeToIso(raw);
      if (iso === null) {
        ctx.addIssue({ code: 'custom', message: `${label} is not a valid date` });
        return z.NEVER;
      }
      return iso;
    });
}

/** Days from now → ISO timestamp (for "expires in N days" style inputs). */
export function isoDaysFromNow(days: number, now: number = Date.now()): string {
  return new Date(now + days * 24 * 3600 * 1000).toISOString();
}
