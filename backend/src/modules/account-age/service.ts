/**
 * AccountAgeService (§6.3): resolves and caches a player's account creation date
 * on the `players` row.
 *
 * Caching rules:
 * - a known result (source steam/server_reported) is refreshed after
 *   ACCOUNT_AGE_CACHE_DAYS (default 7);
 * - an `unknown` result is retried after 1 day;
 * - the plugin's `account_created_at` hint is untrusted: it becomes
 *   `server_reported` only when the provider yields nothing and no better cached
 *   value exists; hints in the future or before 2003 (Steam launch) are ignored.
 *
 * `days` is computed from the injected clock. R4: age is never a verdict.
 */
import type { AccountAgeSource, PlayerRef } from '@scpsl-trust/shared';

import type { DbExecutor } from '../../db';
import type { PlayerRow } from '../../db';
import type { Clock } from '../../lib/time';
import type { AccountAgeProvider } from './provider';

export const HINT_MIN_DATE = new Date('2003-01-01T00:00:00.000Z');
export const UNKNOWN_RETRY_DAYS = 1;
const DAY_MS = 86_400_000;

export interface AccountAgeResult {
  days: number | null;
  created_at: Date | null;
  source: AccountAgeSource;
}

export interface AccountAgeServiceOptions {
  provider: AccountAgeProvider;
  clock: Clock;
  /** ACCOUNT_AGE_CACHE_DAYS. */
  cacheDays: number;
}

export class AccountAgeService {
  private readonly provider: AccountAgeProvider;
  private readonly clock: Clock;
  private readonly cacheDays: number;

  constructor(options: AccountAgeServiceOptions) {
    this.provider = options.provider;
    this.clock = options.clock;
    this.cacheDays = options.cacheDays;
  }

  /** Validated hint date or null. Exported for tests via the instance. */
  validateHint(hint: string | Date | null | undefined, now: Date): Date | null {
    if (hint === null || hint === undefined) return null;
    const date = hint instanceof Date ? hint : new Date(hint);
    if (Number.isNaN(date.getTime())) return null;
    if (date.getTime() > now.getTime()) return null; // in the future
    if (date.getTime() < HINT_MIN_DATE.getTime()) return null; // before 2003
    return date;
  }

  daysSince(created: Date | null, now: Date): number | null {
    if (created === null) return null;
    return Math.max(0, Math.floor((now.getTime() - created.getTime()) / DAY_MS));
  }

  private isFresh(player: PlayerRow, now: Date): boolean {
    if (player.account_age_checked_at === null) return false;
    const ageMs = now.getTime() - player.account_age_checked_at.getTime();
    const windowDays = player.account_age_source === 'unknown' ? UNKNOWN_RETRY_DAYS : this.cacheDays;
    return ageMs < windowDays * DAY_MS;
  }

  /**
   * Resolves the account age for `player`, updating the cached columns on the
   * players row (inside the caller's transaction) when a refresh happened.
   */
  async resolve(tx: DbExecutor, player: PlayerRow, hint: string | Date | null | undefined): Promise<AccountAgeResult> {
    const now = this.clock.now();
    if (this.isFresh(player, now)) {
      return {
        days: this.daysSince(player.account_created_at, now),
        created_at: player.account_created_at,
        source: player.account_age_source,
      };
    }

    const providerResult = await this.provider.resolve({ type: player.id_type, id: player.external_id } satisfies PlayerRef);
    let created: Date | null;
    let source: AccountAgeSource;
    if (providerResult !== null) {
      created = providerResult.created_at;
      source = 'steam';
    } else if (player.account_created_at !== null && player.account_age_source !== 'unknown') {
      // Provider yielded nothing this time; keep the previously known value.
      created = player.account_created_at;
      source = player.account_age_source;
    } else {
      const validHint = this.validateHint(hint, now);
      if (validHint !== null) {
        created = validHint;
        source = 'server_reported';
      } else {
        created = null;
        source = 'unknown';
      }
    }

    await tx
      .updateTable('players')
      .set({
        account_created_at: created,
        account_age_source: source,
        account_age_checked_at: now,
        updated_at: now,
      })
      .where('id', '=', player.id)
      .execute();

    return { days: this.daysSince(created, now), created_at: created, source };
  }
}
