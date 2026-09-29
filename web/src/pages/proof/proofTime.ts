/**
 * Timestamp helpers for the proof form: the browser's `datetime-local` value is interpreted as
 * UTC (proof windows are defined on unix time), and kept in sync with a unix-milliseconds field.
 */

const LOCAL_REGEX = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;

/** `YYYY-MM-DDTHH:mm[:ss[.SSS]]` read as UTC → epoch ms, or null when malformed. */
export function datetimeLocalToMs(value: string): number | null {
  const match = LOCAL_REGEX.exec(value.trim());
  if (match === null) return null;
  const [, year, month, day, hours, minutes, seconds = '0', millis = '0'] = match;
  const ms = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hours), Number(minutes), Number(seconds), Number(millis.padEnd(3, '0')));
  return Number.isFinite(ms) ? ms : null;
}

/** epoch ms → `YYYY-MM-DDTHH:mm:ss` in UTC (for a `datetime-local` input). */
export function msToDatetimeLocal(ms: number): string {
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toISOString().slice(0, 19);
}

/** Digits only → epoch ms, else null. */
export function parseUnixMs(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d{1,16}$/.test(trimmed)) return null;
  const ms = Number(trimmed);
  return Number.isSafeInteger(ms) ? ms : null;
}
