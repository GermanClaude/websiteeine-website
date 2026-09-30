/**
 * Composite VPN provider (§6.4): runs every configured provider concurrently with a
 * per-provider timeout (AbortSignal) and a simple circuit breaker (a provider that
 * failed `failureThreshold` times in a row is skipped for `cooldownMs`). The result
 * is the answer with the highest confidence. When no provider answers at all the
 * lookup degrades to `not_detected` with `checked: false` and
 * `error: 'provider_unavailable'` — the plugin's policy decides what that means.
 */
import { vpnConfidenceRank } from '@scpsl-trust/shared';

import type { Clock } from '../../lib/time';
import { type VpnCheckResult, type VpnDetectionProvider, type VpnLookupResult } from './types';

export interface CompositeVpnOptions {
  /** Per-provider timeout in milliseconds (default 1500). */
  timeoutMs?: number;
  /** Consecutive failures after which a provider's breaker opens (default 3). */
  failureThreshold?: number;
  /** How long an open breaker skips the provider, in milliseconds (default 60000). */
  cooldownMs?: number;
  clock?: Clock;
  onProviderError?: (provider: string, error: unknown) => void;
}

interface BreakerState {
  consecutiveFailures: number;
  openUntilMs: number | null;
}

export class CompositeVpnProvider implements VpnDetectionProvider {
  readonly name = 'composite';
  private readonly providers: readonly VpnDetectionProvider[];
  private readonly timeoutMs: number;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly clock: Clock;
  private readonly breakers = new Map<string, BreakerState>();
  private readonly onProviderError: ((provider: string, error: unknown) => void) | undefined;

  constructor(providers: readonly VpnDetectionProvider[], options: CompositeVpnOptions = {}) {
    if (providers.length === 0) throw new Error('CompositeVpnProvider needs at least one provider');
    this.providers = providers;
    this.timeoutMs = options.timeoutMs ?? 1500;
    this.failureThreshold = options.failureThreshold ?? 3;
    this.cooldownMs = options.cooldownMs ?? 60_000;
    this.clock = options.clock ?? { now: () => new Date() };
    this.onProviderError = options.onProviderError;
  }

  /** Breaker state for tests/diagnostics. */
  breakerState(provider: string): { consecutiveFailures: number; open: boolean } {
    const state = this.breakers.get(provider);
    if (state === undefined) return { consecutiveFailures: 0, open: false };
    return {
      consecutiveFailures: state.consecutiveFailures,
      open: state.openUntilMs !== null && state.openUntilMs > this.clock.now().getTime(),
    };
  }

  private breaker(provider: string): BreakerState {
    let state = this.breakers.get(provider);
    if (state === undefined) this.breakers.set(provider, (state = { consecutiveFailures: 0, openUntilMs: null }));
    return state;
  }

  private async checkOne(provider: VpnDetectionProvider, ip: string): Promise<VpnCheckResult | null> {
    const state = this.breaker(provider.name);
    const nowMs = this.clock.now().getTime();
    if (state.openUntilMs !== null && state.openUntilMs > nowMs) return null; // breaker open → skip
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new Error(`${provider.name} timed out after ${this.timeoutMs} ms`)), this.timeoutMs);
    try {
      const result = await provider.check(ip, controller.signal);
      if (controller.signal.aborted) throw new Error(`${provider.name} timed out after ${this.timeoutMs} ms`);
      state.consecutiveFailures = 0;
      state.openUntilMs = null;
      return result;
    } catch (error) {
      state.consecutiveFailures += 1;
      if (state.consecutiveFailures >= this.failureThreshold) {
        state.openUntilMs = this.clock.now().getTime() + this.cooldownMs;
      }
      this.onProviderError?.(provider.name, error);
      return null;
    } finally {
      clearTimeout(timer);
    }
  }

  async check(ip: string): Promise<VpnLookupResult> {
    const settled = await Promise.all(this.providers.map((provider) => this.checkOne(provider, ip)));
    const answers = settled.filter((result): result is VpnCheckResult => result !== null);
    if (answers.length === 0) {
      return {
        detected: false,
        confidence: 'not_detected',
        type: null,
        provider: this.name,
        checked: false,
        error: 'provider_unavailable',
      };
    }
    let best = answers[0]!;
    for (const answer of answers.slice(1)) {
      if (vpnConfidenceRank(answer.confidence) > vpnConfidenceRank(best.confidence)) best = answer;
    }
    return { ...best, detected: best.detected, checked: true };
  }
}
