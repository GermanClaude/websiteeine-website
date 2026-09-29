/** `SHA256:3f4a9c…` — first hex characters of a key fingerprint for tables. */
export function shortFingerprint(fingerprint: string | null | undefined, hexChars = 12): string {
  if (fingerprint === null || fingerprint === undefined || fingerprint === '') return '—';
  const separator = fingerprint.indexOf(':');
  if (separator < 0) return truncateEnd(fingerprint, hexChars);
  const prefix = fingerprint.slice(0, separator + 1);
  const hex = fingerprint.slice(separator + 1);
  return hex.length <= hexChars ? fingerprint : `${prefix}${hex.slice(0, hexChars)}…`;
}

export function truncateEnd(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`;
}

export function truncateMiddle(value: string, max: number): string {
  if (value.length <= max || max < 5) return value;
  const half = Math.floor((max - 1) / 2);
  return `${value.slice(0, half)}…${value.slice(value.length - (max - 1 - half))}`;
}

/** `mm:ss` for a number of seconds. */
export function formatCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB', 'TiB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}
