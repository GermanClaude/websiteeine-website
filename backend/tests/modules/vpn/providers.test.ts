/**
 * VPN providers (§6.4): CIDR matching (v4/v6 edge ranges), proxycheck/iphub
 * mapping with mocked fetch, composite timeout, circuit breaker and
 * highest-confidence-wins.
 */
import { describe, expect, it } from 'vitest';

import { createAdjustableClock } from '../../../src/lib/time';
import {
  CidrListVpnProvider,
  CidrMatcher,
  CompositeVpnProvider,
  IpHubProvider,
  NoopVpnProvider,
  ProxyCheckIoProvider,
  type FetchLike,
  type VpnCheckResult,
  type VpnDetectionProvider,
} from '../../../src/modules/vpn';

function jsonFetch(body: unknown, status = 200): FetchLike {
  return async () => ({ ok: status >= 200 && status < 300, status, json: async () => body });
}

function fixedProvider(name: string, result: Partial<VpnCheckResult>): VpnDetectionProvider {
  return {
    name,
    check: async () => ({ detected: false, confidence: 'not_detected', type: null, provider: name, ...result }),
  };
}

function failingProvider(name: string): VpnDetectionProvider {
  return {
    name,
    check: async () => {
      throw new Error(`${name} exploded`);
    },
  };
}

describe('NoopVpnProvider', () => {
  it('never detects anything', async () => {
    const result = await new NoopVpnProvider().check();
    expect(result).toEqual({ detected: false, confidence: 'not_detected', type: null, provider: 'noop' });
  });
});

describe('CidrMatcher', () => {
  it('parses lists with comments, blank lines and bare addresses', () => {
    const matcher = new CidrMatcher();
    matcher.addText(
      [
        '# hosting ranges',
        '',
        '203.0.113.0/24   ; documentation',
        '198.51.100.42',
        '2001:db8:beef::/48',
        '2001:db8:1:2:3:4:5:6',
        'not-an-ip',
        '10.0.0.0/33',
      ].join('\n'),
    );
    expect(matcher.size).toBe(4);
    expect(matcher.issues).toHaveLength(2);
    expect(matcher.matches('203.0.113.1')).toBe(true);
    expect(matcher.matches('198.51.100.42')).toBe(true);
    expect(matcher.matches('198.51.100.43')).toBe(false);
    expect(matcher.matches('2001:db8:beef:ffff::1')).toBe(true);
    expect(matcher.matches('2001:db8:1:2:3:4:5:6')).toBe(true);
    expect(matcher.matches('2001:db8:1:2:3:4:5:7')).toBe(false);
  });

  it('matches IPv4 edge ranges exactly', () => {
    const matcher = new CidrMatcher();
    matcher.addText('203.0.113.128/25');
    expect(matcher.matches('203.0.113.127')).toBe(false);
    expect(matcher.matches('203.0.113.128')).toBe(true);
    expect(matcher.matches('203.0.113.255')).toBe(true);
    expect(matcher.matches('203.0.114.0')).toBe(false);
  });

  it('matches IPv6 edge ranges and /0', () => {
    const matcher = new CidrMatcher();
    matcher.addText('2001:db8:8000::/33');
    expect(matcher.matches('2001:db8:7fff:ffff::1')).toBe(false);
    expect(matcher.matches('2001:db8:8000::')).toBe(true);
    expect(matcher.matches('2001:db8:ffff:ffff:ffff:ffff:ffff:ffff')).toBe(true);
    const all = new CidrMatcher();
    all.addText('0.0.0.0/0');
    expect(all.matches('8.8.8.8')).toBe(true);
    expect(all.matches('2001:db8::1')).toBe(false); // v4 entry never matches v6
  });

  it('treats IPv4-mapped IPv6 input as IPv4', () => {
    const matcher = new CidrMatcher();
    matcher.addText('203.0.113.0/24');
    expect(matcher.matches('::ffff:203.0.113.9')).toBe(true);
  });
});

describe('CidrListVpnProvider', () => {
  it('answers with the configured confidence and hosting type', async () => {
    const provider = new CidrListVpnProvider({ text: '203.0.113.0/24', confidence: 'confirmed' });
    expect(await provider.check('203.0.113.7')).toEqual({
      detected: true,
      confidence: 'confirmed',
      type: 'hosting',
      provider: 'cidr-list',
    });
    expect((await provider.check('198.51.100.1')).detected).toBe(false);
  });
});

describe('ProxyCheckIoProvider', () => {
  const signal = new AbortController().signal;

  it('maps a positive answer to confirmed with the right type', async () => {
    const provider = new ProxyCheckIoProvider({
      fetch: jsonFetch({ status: 'ok', '203.0.113.7': { proxy: 'yes', type: 'VPN' } }),
      apiKey: 'k',
    });
    expect(await provider.check('203.0.113.7', signal)).toEqual({
      detected: true,
      confidence: 'confirmed',
      type: 'vpn',
      provider: 'proxycheck',
    });
  });

  it('maps unknown types to unknown and no to not_detected', async () => {
    const yes = new ProxyCheckIoProvider({ fetch: jsonFetch({ status: 'ok', '1.2.3.4': { proxy: 'yes', type: 'Quantum' } }) });
    expect((await yes.check('1.2.3.4', signal)).type).toBe('unknown');
    const no = new ProxyCheckIoProvider({ fetch: jsonFetch({ status: 'ok', '1.2.3.4': { proxy: 'no' } }) });
    expect((await no.check('1.2.3.4', signal)).detected).toBe(false);
  });

  it('throws on denied status, HTTP errors and missing address entries', async () => {
    await expect(
      new ProxyCheckIoProvider({ fetch: jsonFetch({ status: 'denied', message: 'no key' }) }).check('1.2.3.4', signal),
    ).rejects.toThrow(/denied/);
    await expect(new ProxyCheckIoProvider({ fetch: jsonFetch({}, 500) }).check('1.2.3.4', signal)).rejects.toThrow(/500/);
    await expect(new ProxyCheckIoProvider({ fetch: jsonFetch({ status: 'ok' }) }).check('1.2.3.4', signal)).rejects.toThrow(
      /missing/,
    );
  });

  it('sends the api key only when configured', async () => {
    const urls: string[] = [];
    const fetch: FetchLike = async (url) => {
      urls.push(url);
      return { ok: true, status: 200, json: async () => ({ status: 'ok', '1.2.3.4': { proxy: 'no' } }) };
    };
    await new ProxyCheckIoProvider({ fetch, apiKey: 'secret-key' }).check('1.2.3.4', signal);
    await new ProxyCheckIoProvider({ fetch }).check('1.2.3.4', signal);
    expect(urls[0]).toContain('key=secret-key');
    expect(urls[1]).not.toContain('key=');
  });
});

describe('IpHubProvider', () => {
  const signal = new AbortController().signal;

  it('maps block levels to the documented confidences', async () => {
    const block1 = new IpHubProvider({ fetch: jsonFetch({ block: 1 }), apiKey: 'k' });
    expect(await block1.check('1.2.3.4', signal)).toEqual({
      detected: true,
      confidence: 'confirmed',
      type: 'hosting',
      provider: 'iphub',
    });
    const block2 = new IpHubProvider({ fetch: jsonFetch({ block: 2 }), apiKey: 'k' });
    expect(await block2.check('1.2.3.4', signal)).toMatchObject({ detected: true, confidence: 'possible', type: 'unknown' });
    const block0 = new IpHubProvider({ fetch: jsonFetch({ block: 0 }), apiKey: 'k' });
    expect((await block0.check('1.2.3.4', signal)).detected).toBe(false);
  });

  it('sends the X-Key header and throws on failures', async () => {
    let seenKey: string | undefined;
    const fetch: FetchLike = async (_url, init) => {
      seenKey = init?.headers?.['X-Key'];
      return { ok: true, status: 200, json: async () => ({ block: 0 }) };
    };
    await new IpHubProvider({ fetch, apiKey: 'my-key' }).check('1.2.3.4', signal);
    expect(seenKey).toBe('my-key');
    await expect(new IpHubProvider({ fetch: jsonFetch({}, 429), apiKey: 'k' }).check('1.2.3.4', signal)).rejects.toThrow(/429/);
    await expect(new IpHubProvider({ fetch: jsonFetch({ nope: true }), apiKey: 'k' }).check('1.2.3.4', signal)).rejects.toThrow();
  });
});

describe('CompositeVpnProvider', () => {
  it('returns the highest-confidence answer among providers', async () => {
    const composite = new CompositeVpnProvider([
      fixedProvider('a', { detected: true, confidence: 'possible', type: 'proxy' }),
      fixedProvider('b', { detected: true, confidence: 'likely', type: 'vpn' }),
      fixedProvider('c', {}),
    ]);
    const result = await composite.check('203.0.113.1');
    expect(result).toMatchObject({ detected: true, confidence: 'likely', type: 'vpn', provider: 'b', checked: true });
  });

  it('tolerates single-provider failures', async () => {
    const composite = new CompositeVpnProvider([
      failingProvider('down'),
      fixedProvider('up', { detected: true, confidence: 'confirmed', type: 'tor' }),
    ]);
    const result = await composite.check('203.0.113.1');
    expect(result).toMatchObject({ detected: true, confidence: 'confirmed', checked: true });
  });

  it('degrades to provider_unavailable when every provider fails', async () => {
    const composite = new CompositeVpnProvider([failingProvider('a'), failingProvider('b')]);
    const result = await composite.check('203.0.113.1');
    expect(result).toEqual({
      detected: false,
      confidence: 'not_detected',
      type: null,
      provider: 'composite',
      checked: false,
      error: 'provider_unavailable',
    });
  });

  it('aborts a provider that exceeds the timeout', async () => {
    const slow: VpnDetectionProvider = {
      name: 'slow',
      check: (_ip, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    };
    const composite = new CompositeVpnProvider([slow], { timeoutMs: 30 });
    const result = await composite.check('203.0.113.1');
    expect(result.checked).toBe(false);
    expect(result.error).toBe('provider_unavailable');
  });

  it('opens the circuit breaker after N consecutive failures and closes it after the cooldown', async () => {
    const clock = createAdjustableClock('2026-09-29T12:00:00.000Z');
    let calls = 0;
    let healthy = false;
    const flaky: VpnDetectionProvider = {
      name: 'flaky',
      check: async () => {
        calls += 1;
        if (!healthy) throw new Error('down');
        return { detected: true, confidence: 'likely', type: 'vpn', provider: 'flaky' };
      },
    };
    const composite = new CompositeVpnProvider([flaky], { failureThreshold: 2, cooldownMs: 60_000, clock });
    await composite.check('1.2.3.4');
    expect(composite.breakerState('flaky').open).toBe(false);
    await composite.check('1.2.3.4');
    expect(composite.breakerState('flaky')).toEqual({ consecutiveFailures: 2, open: true });
    // Open breaker: the provider is skipped entirely.
    healthy = true;
    const skipped = await composite.check('1.2.3.4');
    expect(calls).toBe(2);
    expect(skipped.error).toBe('provider_unavailable');
    // After the cooldown the provider is tried again and the breaker resets.
    clock.advance(60_001);
    const recovered = await composite.check('1.2.3.4');
    expect(calls).toBe(3);
    expect(recovered).toMatchObject({ detected: true, confidence: 'likely', checked: true });
    expect(composite.breakerState('flaky')).toEqual({ consecutiveFailures: 0, open: false });
  });

  it('a success resets the consecutive failure count', async () => {
    let fail = true;
    const provider: VpnDetectionProvider = {
      name: 'p',
      check: async () => {
        if (fail) throw new Error('down');
        return { detected: false, confidence: 'not_detected', type: null, provider: 'p' };
      },
    };
    const composite = new CompositeVpnProvider([provider], { failureThreshold: 3 });
    await composite.check('1.2.3.4');
    fail = false;
    await composite.check('1.2.3.4');
    fail = true;
    await composite.check('1.2.3.4');
    await composite.check('1.2.3.4');
    expect(composite.breakerState('p').open).toBe(false); // 2 < threshold since the reset
  });
});
