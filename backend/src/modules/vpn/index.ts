/**
 * VPN detection module (§6.4). Not a Fastify module: it is a library the players
 * module composes. `createVpnProvider(config)` builds the provider stack from
 * VPN_PROVIDERS.
 */
import type { Config } from '../../config';
import type { Clock } from '../../lib/time';
import { CidrListVpnProvider } from './cidr';
import { CompositeVpnProvider, type CompositeVpnOptions } from './composite';
import { IpHubProvider, NoopVpnProvider, ProxyCheckIoProvider } from './providers';
import type { FetchLike, VpnDetectionProvider } from './types';

export * from './types';
export { CidrListVpnProvider, CidrMatcher, type CidrListProviderOptions, type CidrParseIssue } from './cidr';
export { CompositeVpnProvider, type CompositeVpnOptions } from './composite';
export { IpHubProvider, NoopVpnProvider, ProxyCheckIoProvider, type IpHubOptions, type ProxyCheckIoOptions } from './providers';
export { VpnService, type VpnServiceOptions } from './service';

export interface CreateVpnProviderOptions {
  fetch?: FetchLike;
  clock?: Clock;
  onProviderError?: CompositeVpnOptions['onProviderError'];
}

/** Builds the composite provider stack from `config.vpn` (VPN_PROVIDERS). */
export function createVpnProvider(config: Config['vpn'], options: CreateVpnProviderOptions = {}): CompositeVpnProvider {
  const fetchImpl: FetchLike = options.fetch ?? (globalThis.fetch as unknown as FetchLike);
  const providers: VpnDetectionProvider[] = [];
  for (const name of config.providers) {
    switch (name) {
      case 'noop':
        providers.push(new NoopVpnProvider());
        break;
      case 'cidr-list':
        providers.push(new CidrListVpnProvider({ paths: config.cidrListPaths, confidence: config.cidrConfidence }));
        break;
      case 'proxycheck':
        providers.push(new ProxyCheckIoProvider({ fetch: fetchImpl, apiKey: config.proxycheckApiKey }));
        break;
      case 'iphub':
        if (config.iphubApiKey === null) throw new Error('IPHUB_API_KEY is required for the iphub VPN provider');
        providers.push(new IpHubProvider({ fetch: fetchImpl, apiKey: config.iphubApiKey }));
        break;
    }
  }
  if (providers.length === 0) providers.push(new NoopVpnProvider());
  const compositeOptions: CompositeVpnOptions = { timeoutMs: config.providerTimeoutMs };
  if (options.clock !== undefined) compositeOptions.clock = options.clock;
  if (options.onProviderError !== undefined) compositeOptions.onProviderError = options.onProviderError;
  return new CompositeVpnProvider(providers, compositeOptions);
}
