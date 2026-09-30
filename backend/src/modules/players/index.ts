/**
 * players module (§6.1, §6.2, §13 "Players", §8): the player check pipeline and
 * the web player views. Composes the vpn, account-age and alt sub-modules.
 */
import type { FastifyInstance } from 'fastify';

import type { Deps } from '../../container';
import type { JobScheduler } from '../../jobs/scheduler';
import { AccountAgeService, createAccountAgeProvider } from '../account-age';
import { AltService } from '../alt';
import { createVpnProvider, VpnService } from '../vpn';
import { registerPlayersJobs } from './jobs';
import { registerPluginRoutes } from './plugin-routes';
import { registerWebRoutes } from './routes';
import { PlayersService } from './service';

export function createPlayersService(deps: Deps): PlayersService {
  const vpnProvider = createVpnProvider(deps.config.vpn, {
    clock: deps.clock,
    onProviderError: (provider, error) => deps.logger.warn({ err: error, provider }, 'vpn provider failed'),
  });
  const vpn = new VpnService({
    provider: vpnProvider,
    store: deps.store,
    ipHashSecret: deps.config.secrets.ipHashSecret,
    cacheTtlSeconds: deps.config.vpn.cacheTtlSeconds,
    logger: deps.logger,
  });
  const accountAge = new AccountAgeService({
    provider: createAccountAgeProvider(deps.config.accountAge, { logger: deps.logger }),
    clock: deps.clock,
    cacheDays: deps.config.accountAge.cacheDays,
  });
  const alt = new AltService({
    lookbackDays: deps.config.alt.lookbackDays,
    maxSharedAccounts: deps.config.alt.maxSharedAccounts,
  });
  return new PlayersService({ deps, vpn, accountAge, alt });
}

export default async function register(app: FastifyInstance, deps: Deps): Promise<void> {
  const service = createPlayersService(deps);
  await registerPluginRoutes(app, deps, service);
  await registerWebRoutes(app, deps, service);
}

export function registerJobs(scheduler: JobScheduler, deps: Deps): void {
  registerPlayersJobs(scheduler, deps);
}
