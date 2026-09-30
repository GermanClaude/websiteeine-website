/**
 * Account age module (§6.3). A library composed by the players module, not a
 * Fastify module.
 */
import type { Config } from '../../config';
import type { AppLogger } from '../../lib/logger';
import type { FetchLike } from '../vpn/types';
import { NoopAccountAgeProvider, SteamWebApiAccountAgeProvider, type AccountAgeProvider } from './provider';

export { NoopAccountAgeProvider, SteamWebApiAccountAgeProvider, type AccountAgeProvider, type SteamWebApiOptions } from './provider';
export { AccountAgeService, HINT_MIN_DATE, UNKNOWN_RETRY_DAYS, type AccountAgeResult, type AccountAgeServiceOptions } from './service';

export interface CreateAccountAgeProviderOptions {
  fetch?: FetchLike;
  logger?: AppLogger;
}

/** Steam provider when STEAM_WEB_API_KEY is configured, noop otherwise. */
export function createAccountAgeProvider(config: Config['accountAge'], options: CreateAccountAgeProviderOptions = {}): AccountAgeProvider {
  if (config.steamWebApiKey === null) return new NoopAccountAgeProvider();
  return new SteamWebApiAccountAgeProvider({
    apiKey: config.steamWebApiKey,
    fetch: options.fetch ?? (globalThis.fetch as unknown as FetchLike),
    logger: options.logger,
  });
}
