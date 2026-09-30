/**
 * VPN detection provider contract (ARCHITECTURE §6.4).
 *
 * A provider answers "does this address belong to a VPN/proxy/hosting network"
 * with a confidence — never anything about the player. R3: a VPN is not cheating;
 * the result only feeds the `vpn` policy signal.
 */
import type { VpnConfidence, VpnType } from '@scpsl-trust/shared';

export interface VpnCheckResult {
  detected: boolean;
  confidence: VpnConfidence;
  type: VpnType | null;
  provider: string;
}

export interface VpnDetectionProvider {
  readonly name: string;
  /** Resolves with a result or rejects on provider failure (network, quota, bad response). */
  check(ip: string, signal: AbortSignal): Promise<VpnCheckResult>;
}

/** Composite/service level result: adds whether any provider actually answered. */
export interface VpnLookupResult extends VpnCheckResult {
  checked: boolean;
  error?: 'provider_unavailable';
}

export const NOT_DETECTED = (provider: string): VpnCheckResult => ({
  detected: false,
  confidence: 'not_detected',
  type: null,
  provider,
});

/** Minimal fetch signature (injected so tests never touch the network). */
export type FetchLike = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;
