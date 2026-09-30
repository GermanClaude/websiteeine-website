/**
 * Account age providers (§6.3). A provider answers "when was this account created"
 * or null when it cannot know (non-steam id, private profile, API failure).
 * R4: account age is never a verdict — it only feeds the `account_age` signal.
 */
import type { PlayerRef } from '@scpsl-trust/shared';

import type { AppLogger } from '../../lib/logger';
import type { FetchLike } from '../vpn/types';

export interface AccountAgeProvider {
  readonly name: string;
  /** Resolves the account creation date, or null when unknown. Never throws. */
  resolve(player: PlayerRef): Promise<{ created_at: Date } | null>;
}

export class NoopAccountAgeProvider implements AccountAgeProvider {
  readonly name = 'noop';

  async resolve(): Promise<null> {
    return null;
  }
}

export interface SteamWebApiOptions {
  apiKey: string;
  fetch: FetchLike;
  baseUrl?: string;
  timeoutMs?: number;
  logger?: AppLogger | undefined;
}

/**
 * ISteamUser/GetPlayerSummaries/v2: `timecreated` (unix seconds) is only present
 * for public profiles. Only steam ids are looked up; every failure → null.
 */
export class SteamWebApiAccountAgeProvider implements AccountAgeProvider {
  readonly name = 'steam';
  private readonly apiKey: string;
  private readonly fetch: FetchLike;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly logger: AppLogger | undefined;

  constructor(options: SteamWebApiOptions) {
    this.apiKey = options.apiKey;
    this.fetch = options.fetch;
    this.baseUrl = (options.baseUrl ?? 'https://api.steampowered.com').replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? 3000;
    this.logger = options.logger;
  }

  async resolve(player: PlayerRef): Promise<{ created_at: Date } | null> {
    if (player.type !== 'steam') return null;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error('steam web api timed out')), this.timeoutMs);
    try {
      const params = new URLSearchParams({ key: this.apiKey, steamids: player.id });
      const res = await this.fetch(`${this.baseUrl}/ISteamUser/GetPlayerSummaries/v2/?${params.toString()}`, {
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`steam web api answered HTTP ${res.status}`);
      const body: unknown = await res.json();
      const players = (body as { response?: { players?: unknown } } | null)?.response?.players;
      if (!Array.isArray(players) || players.length === 0) return null; // unknown id
      const timecreated = (players[0] as { timecreated?: unknown }).timecreated;
      if (typeof timecreated !== 'number' || !Number.isFinite(timecreated) || timecreated <= 0) {
        return null; // private profile: no timecreated field
      }
      return { created_at: new Date(Math.floor(timecreated) * 1000) };
    } catch (error) {
      this.logger?.warn({ err: error }, 'steam account age lookup failed');
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
