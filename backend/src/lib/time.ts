/**
 * Injectable clock. Services must read time from `Clock` (never `new Date()` directly)
 * so tests can pin and advance time deterministically.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = Object.freeze({
  now: () => new Date(),
});

/** Clock that always returns the same instant. */
export function createFixedClock(at: Date | string | number): Clock {
  const ms = new Date(at).getTime();
  if (!Number.isFinite(ms)) throw new RangeError('createFixedClock: invalid date');
  return { now: () => new Date(ms) };
}

export interface AdjustableClock extends Clock {
  /** Sets the current instant. */
  set(at: Date | string | number): void;
  /** Moves time forward (or backward with a negative value) by `ms`. */
  advance(ms: number): void;
  advanceSeconds(seconds: number): void;
}

/** Test clock starting at `start` (default: real now) that only moves when told to. */
export function createAdjustableClock(start: Date | string | number = Date.now()): AdjustableClock {
  let current = new Date(start).getTime();
  if (!Number.isFinite(current)) throw new RangeError('createAdjustableClock: invalid date');
  return {
    now: () => new Date(current),
    set(at) {
      const next = new Date(at).getTime();
      if (!Number.isFinite(next)) throw new RangeError('AdjustableClock.set: invalid date');
      current = next;
    },
    advance(ms) {
      if (!Number.isFinite(ms)) throw new RangeError('AdjustableClock.advance: invalid ms');
      current += ms;
    },
    advanceSeconds(seconds) {
      this.advance(seconds * 1000);
    },
  };
}

export function addMilliseconds(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export function addSeconds(date: Date, seconds: number): Date {
  return addMilliseconds(date, seconds * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return addMilliseconds(date, minutes * 60_000);
}

export function addHours(date: Date, hours: number): Date {
  return addMilliseconds(date, hours * 3_600_000);
}

export function addDays(date: Date, days: number): Date {
  return addMilliseconds(date, days * 86_400_000);
}

/** ISO-8601 UTC with milliseconds (wire format, §2.1). */
export function toIso(date: Date): string {
  return date.toISOString();
}

/** toIso for nullable values. */
export function toIsoOrNull(date: Date | null | undefined): string | null {
  return date === null || date === undefined ? null : date.toISOString();
}
