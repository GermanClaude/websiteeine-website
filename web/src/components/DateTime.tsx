import { useEffect, useState } from 'react';

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: 'numeric',
  month: 'short',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});
const dateFormat = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
const timeFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });

function toDate(value: string | number | Date): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatUtc(value: string | number | Date): string {
  const date = toDate(value);
  return date === null ? String(value) : `${date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '')} UTC`;
}

export function formatDateTime(value: string | number | Date, format: 'datetime' | 'date' | 'time' = 'datetime'): string {
  const date = toDate(value);
  if (date === null) return String(value);
  if (format === 'date') return dateFormat.format(date);
  if (format === 'time') return timeFormat.format(date);
  return dateTimeFormat.format(date);
}

const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number]> = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

/** "3 minutes ago", "in 2 days", "just now". */
export function formatRelative(value: string | number | Date, now: number = Date.now()): string {
  const date = toDate(value);
  if (date === null) return String(value);
  const diffSeconds = Math.round((date.getTime() - now) / 1000);
  if (Math.abs(diffSeconds) < 45) return 'just now';
  for (const [unit, seconds] of UNITS) {
    if (Math.abs(diffSeconds) >= seconds) {
      return relativeFormat.format(Math.round(diffSeconds / seconds), unit);
    }
  }
  return relativeFormat.format(diffSeconds, 'second');
}

export interface DateTimeProps {
  value: string | number | Date | null | undefined;
  format?: 'datetime' | 'date' | 'time';
  /** Text shown for null/undefined values. */
  empty?: string;
}

/** Local date/time with the exact UTC timestamp as tooltip. */
export function DateTime({ value, format = 'datetime', empty = '—' }: DateTimeProps) {
  if (value === null || value === undefined) return <span className="text-faint">{empty}</span>;
  const date = toDate(value);
  if (date === null) return <span>{String(value)}</span>;
  return (
    <time dateTime={date.toISOString()} title={formatUtc(date)} className="nowrap">
      {formatDateTime(date, format)}
    </time>
  );
}

export interface RelativeTimeProps {
  value: string | number | Date | null | undefined;
  empty?: string;
  /** Re-render interval in ms (default 30 s). 0 disables. */
  refreshMs?: number;
}

/** Relative time ("5 minutes ago") that refreshes itself, with the UTC timestamp as tooltip. */
export function RelativeTime({ value, empty = '—', refreshMs = 30_000 }: RelativeTimeProps) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (refreshMs <= 0) return;
    const timer = setInterval(() => setNow(Date.now()), refreshMs);
    return () => clearInterval(timer);
  }, [refreshMs]);

  if (value === null || value === undefined) return <span className="text-faint">{empty}</span>;
  const date = toDate(value);
  if (date === null) return <span>{String(value)}</span>;
  return (
    <time dateTime={date.toISOString()} title={formatUtc(date)} className="nowrap">
      {formatRelative(date, now)}
    </time>
  );
}
