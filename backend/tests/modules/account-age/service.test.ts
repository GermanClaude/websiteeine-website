/**
 * Account age (§6.3): steam provider (success, private profile, unknown id,
 * failures), non-steam ids, cache/refresh windows driven by the adjustable clock,
 * and hint handling (untrusted, future/pre-2003 rejected).
 */
import { describe, expect, it } from 'vitest';

import { createAdjustableClock } from '../../../src/lib/time';
import {
  AccountAgeService,
  NoopAccountAgeProvider,
  SteamWebApiAccountAgeProvider,
  type AccountAgeProvider,
} from '../../../src/modules/account-age';
import type { FetchLike } from '../../../src/modules/vpn/types';
import { createPlayer, useTestApp } from '../../helpers';

const NOW = '2026-09-29T12:00:00.000Z';
const DAY_MS = 86_400_000;

function steamFetch(body: unknown, status = 200): FetchLike {
  return async () => ({ ok: status < 300, status, json: async () => body });
}

function countingProvider(created: Date | null) {
  const state = { calls: 0, created };
  const provider: AccountAgeProvider = {
    name: 'counting',
    resolve: async () => {
      state.calls += 1;
      return state.created === null ? null : { created_at: state.created };
    },
  };
  return { provider, state };
}

describe('SteamWebApiAccountAgeProvider', () => {
  const ref = { type: 'steam', id: '76561198000000001' } as const;

  it('resolves timecreated for public profiles', async () => {
    const provider = new SteamWebApiAccountAgeProvider({
      apiKey: 'k',
      fetch: steamFetch({ response: { players: [{ steamid: ref.id, timecreated: 1262304000 }] } }),
    });
    const result = await provider.resolve(ref);
    expect(result?.created_at.toISOString()).toBe('2010-01-01T00:00:00.000Z');
  });

  it('returns null for private profiles (no timecreated)', async () => {
    const provider = new SteamWebApiAccountAgeProvider({
      apiKey: 'k',
      fetch: steamFetch({ response: { players: [{ steamid: ref.id, communityvisibilitystate: 1 }] } }),
    });
    expect(await provider.resolve(ref)).toBeNull();
  });

  it('returns null for unknown ids, HTTP errors, malformed bodies and network failures', async () => {
    expect(await new SteamWebApiAccountAgeProvider({ apiKey: 'k', fetch: steamFetch({ response: { players: [] } }) }).resolve(ref)).toBeNull();
    expect(await new SteamWebApiAccountAgeProvider({ apiKey: 'k', fetch: steamFetch({}, 500) }).resolve(ref)).toBeNull();
    expect(await new SteamWebApiAccountAgeProvider({ apiKey: 'k', fetch: steamFetch('garbage') }).resolve(ref)).toBeNull();
    const failing: FetchLike = async () => {
      throw new Error('network down');
    };
    expect(await new SteamWebApiAccountAgeProvider({ apiKey: 'k', fetch: failing }).resolve(ref)).toBeNull();
  });

  it('never looks up non-steam ids', async () => {
    let calls = 0;
    const fetch: FetchLike = async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => ({}) };
    };
    const provider = new SteamWebApiAccountAgeProvider({ apiKey: 'k', fetch });
    expect(await provider.resolve({ type: 'discord', id: '123456789012345678' })).toBeNull();
    expect(await provider.resolve({ type: 'northwood', id: 'admin' })).toBeNull();
    expect(calls).toBe(0);
  });

  it('sends key and steamids as query parameters', async () => {
    let seenUrl = '';
    const fetch: FetchLike = async (url) => {
      seenUrl = url;
      return { ok: true, status: 200, json: async () => ({ response: { players: [] } }) };
    };
    await new SteamWebApiAccountAgeProvider({ apiKey: 'api-key', fetch }).resolve(ref);
    expect(seenUrl).toContain('/ISteamUser/GetPlayerSummaries/v2/');
    expect(seenUrl).toContain('key=api-key');
    expect(seenUrl).toContain(`steamids=${ref.id}`);
  });
});

describe('AccountAgeService', () => {
  const t = useTestApp({ now: NOW });

  async function freshPlayer() {
    return createPlayer(t().deps);
  }

  function service(provider: AccountAgeProvider, cacheDays = 7) {
    return new AccountAgeService({ provider, clock: t().clock, cacheDays });
  }

  async function reload(id: string) {
    return t().db.selectFrom('players').selectAll().where('id', '=', id).executeTakeFirstOrThrow();
  }

  it('resolves via the provider, computes days from the clock and caches on the row', async () => {
    const player = await freshPlayer();
    const created = new Date(t().clock.now().getTime() - 10 * DAY_MS - 3600_000);
    const { provider, state } = countingProvider(created);
    const svc = service(provider);
    const result = await svc.resolve(t().db, player, null);
    expect(result).toEqual({ days: 10, created_at: created, source: 'steam' });
    const row = await reload(player.id);
    expect(row.account_created_at?.toISOString()).toBe(created.toISOString());
    expect(row.account_age_source).toBe('steam');
    expect(row.account_age_checked_at?.toISOString()).toBe(t().clock.now().toISOString());
    expect(state.calls).toBe(1);
  });

  it('serves a known result from cache and refreshes after ACCOUNT_AGE_CACHE_DAYS', async () => {
    const player = await freshPlayer();
    const created = new Date('2020-06-01T00:00:00.000Z');
    const { provider, state } = countingProvider(created);
    const svc = service(provider, 7);
    await svc.resolve(t().db, player, null);
    // Fresh: no provider call.
    const cachedResult = await svc.resolve(t().db, await reload(player.id), null);
    expect(state.calls).toBe(1);
    expect(cachedResult.source).toBe('steam');
    // Days still track the clock while cached.
    t().clock.advance(3 * DAY_MS);
    const later = await svc.resolve(t().db, await reload(player.id), null);
    expect(later.days).toBe(cachedResult.days! + 3);
    expect(state.calls).toBe(1);
    // Past the cache window → refreshed.
    t().clock.advance(5 * DAY_MS);
    await svc.resolve(t().db, await reload(player.id), null);
    expect(state.calls).toBe(2);
  });

  it('retries an unknown result after 1 day', async () => {
    const player = await freshPlayer();
    const { provider, state } = countingProvider(null);
    const svc = service(provider, 7);
    const unknown = await svc.resolve(t().db, player, null);
    expect(unknown).toEqual({ days: null, created_at: null, source: 'unknown' });
    t().clock.advance(12 * 3600_000); // < 1 day: still cached
    await svc.resolve(t().db, await reload(player.id), null);
    expect(state.calls).toBe(1);
    t().clock.advance(13 * 3600_000); // > 1 day: retried
    state.created = new Date('2024-01-01T00:00:00.000Z');
    const found = await svc.resolve(t().db, await reload(player.id), null);
    expect(state.calls).toBe(2);
    expect(found.source).toBe('steam');
  });

  it('uses the hint as server_reported only when the provider yields nothing', async () => {
    const player = await freshPlayer();
    const hint = '2024-05-01T00:00:00.000Z';
    const noop = new NoopAccountAgeProvider();
    const svc = service(noop);
    const result = await svc.resolve(t().db, player, hint);
    expect(result.source).toBe('server_reported');
    expect(result.created_at?.toISOString()).toBe(hint);
    expect((await reload(player.id)).account_age_source).toBe('server_reported');

    // Provider result always beats the hint.
    const player2 = await freshPlayer();
    const created = new Date('2015-03-01T00:00:00.000Z');
    const { provider } = countingProvider(created);
    const withProvider = await service(provider).resolve(t().db, player2, hint);
    expect(withProvider.source).toBe('steam');
    expect(withProvider.created_at).toEqual(created);
  });

  it('rejects hints in the future or before 2003', async () => {
    const svc = service(new NoopAccountAgeProvider());
    for (const bad of [
      new Date(t().clock.now().getTime() + 60_000).toISOString(),
      '2002-12-31T23:59:59.000Z',
      '1970-01-01T00:00:00.000Z',
      'not-a-date',
    ]) {
      const player = await freshPlayer();
      const result = await svc.resolve(t().db, player, bad);
      expect(result).toEqual({ days: null, created_at: null, source: 'unknown' });
      expect((await reload(player.id)).account_age_source).toBe('unknown');
    }
  });

  it('keeps a previously known value when a later refresh fails', async () => {
    const player = await freshPlayer();
    const created = new Date('2018-01-01T00:00:00.000Z');
    const { provider, state } = countingProvider(created);
    const svc = service(provider, 7);
    await svc.resolve(t().db, player, null);
    t().clock.advance(8 * DAY_MS);
    state.created = null; // provider now fails / yields nothing
    const result = await svc.resolve(t().db, await reload(player.id), null);
    expect(result.source).toBe('steam');
    expect(result.created_at).toEqual(created);
    expect(state.calls).toBe(2);
  });
});
