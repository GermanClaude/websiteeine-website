/**
 * External VPN detection providers (§6.4): proxycheck.io and IPHub, plus the noop
 * provider. Both HTTP providers use an injected fetch, honor the AbortSignal the
 * composite passes them, and throw on any failure — the composite turns failures
 * into `checked: false` / `provider_unavailable`.
 */
import type { VpnType } from '@scpsl-trust/shared';

import { NOT_DETECTED, type FetchLike, type VpnCheckResult, type VpnDetectionProvider } from './types';

export class NoopVpnProvider implements VpnDetectionProvider {
  readonly name = 'noop';

  async check(): Promise<VpnCheckResult> {
    return NOT_DETECTED(this.name);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// ---------------------------------------------------------------------------
// proxycheck.io v2 — https://proxycheck.io/api/
// ---------------------------------------------------------------------------

/** proxycheck `type` values → VpnType. Anything unrecognized becomes `unknown`. */
const PROXYCHECK_TYPES: Record<string, VpnType> = {
  vpn: 'vpn',
  'openvpn': 'vpn',
  'wireguard': 'vpn',
  tor: 'tor',
  proxy: 'proxy',
  socks: 'proxy',
  socks4: 'proxy',
  socks5: 'proxy',
  http: 'proxy',
  https: 'proxy',
  'web proxy': 'proxy',
  hosting: 'hosting',
  'compromised server': 'hosting',
  'scraper': 'hosting',
  relay: 'relay',
  'icloud private relay': 'relay',
};

export interface ProxyCheckIoOptions {
  fetch: FetchLike;
  /** Optional — proxycheck answers anonymously with a lower quota. */
  apiKey?: string | null;
  baseUrl?: string;
}

export class ProxyCheckIoProvider implements VpnDetectionProvider {
  readonly name = 'proxycheck';
  private readonly fetch: FetchLike;
  private readonly apiKey: string | null;
  private readonly baseUrl: string;

  constructor(options: ProxyCheckIoOptions) {
    this.fetch = options.fetch;
    this.apiKey = options.apiKey ?? null;
    this.baseUrl = (options.baseUrl ?? 'https://proxycheck.io/v2').replace(/\/$/, '');
  }

  async check(ip: string, signal: AbortSignal): Promise<VpnCheckResult> {
    const params = new URLSearchParams({ vpn: '1', risk: '0' });
    if (this.apiKey !== null) params.set('key', this.apiKey);
    const res = await this.fetch(`${this.baseUrl}/${encodeURIComponent(ip)}?${params.toString()}`, { signal });
    if (!res.ok) throw new Error(`proxycheck.io answered HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!isRecord(body)) throw new Error('proxycheck.io returned a non-object body');
    const status = typeof body.status === 'string' ? body.status.toLowerCase() : 'ok';
    if (status === 'denied' || status === 'error') {
      throw new Error(`proxycheck.io status ${status}`);
    }
    const entry = body[ip];
    if (!isRecord(entry)) throw new Error('proxycheck.io response is missing the queried address');
    const proxy = typeof entry.proxy === 'string' ? entry.proxy.toLowerCase() : 'no';
    if (proxy !== 'yes') return NOT_DETECTED(this.name);
    const rawType = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
    const type = PROXYCHECK_TYPES[rawType] ?? 'unknown';
    // proxycheck gives a firm yes/no; a positive answer is treated as confirmed.
    return { detected: true, confidence: 'confirmed', type, provider: this.name };
  }
}

// ---------------------------------------------------------------------------
// IPHub v2 — https://iphub.info/api
// ---------------------------------------------------------------------------

export interface IpHubOptions {
  fetch: FetchLike;
  apiKey: string;
  baseUrl?: string;
}

/**
 * IPHub block levels → result:
 *   block 0 — residential/unclassified          → not detected
 *   block 1 — non-residential (hosting/VPN/proxy), IPHub recommends blocking
 *             → detected, confidence `confirmed`, type `hosting`
 *   block 2 — non-residential *or* residential ("burner"/mixed use), false
 *             positives possible → detected, confidence `possible`, type `unknown`
 */
export class IpHubProvider implements VpnDetectionProvider {
  readonly name = 'iphub';
  private readonly fetch: FetchLike;
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(options: IpHubOptions) {
    this.fetch = options.fetch;
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? 'https://v2.api.iphub.info/ip').replace(/\/$/, '');
  }

  async check(ip: string, signal: AbortSignal): Promise<VpnCheckResult> {
    const res = await this.fetch(`${this.baseUrl}/${encodeURIComponent(ip)}`, {
      headers: { 'X-Key': this.apiKey },
      signal,
    });
    if (!res.ok) throw new Error(`IPHub answered HTTP ${res.status}`);
    const body: unknown = await res.json();
    if (!isRecord(body) || typeof body.block !== 'number') throw new Error('IPHub returned an unexpected body');
    switch (body.block) {
      case 1:
        return { detected: true, confidence: 'confirmed', type: 'hosting', provider: this.name };
      case 2:
        return { detected: true, confidence: 'possible', type: 'unknown', provider: this.name };
      default:
        return NOT_DETECTED(this.name);
    }
  }
}
