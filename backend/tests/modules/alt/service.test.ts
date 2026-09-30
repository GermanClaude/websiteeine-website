/**
 * Alt-account heuristics (§8.2): one test per confidence rule, the VPN cap, the
 * many-accounts downgrade, the exact 'high' conjunction, recorded observations,
 * player_links and player_signals (never IPs).
 */
import { describe, expect, it, beforeAll } from 'vitest';

import { withTransaction } from '../../../src/db';
import { networkHashes, type NetworkHashes } from '../../../src/lib/ip';
import { AltService, type AltAnalysis } from '../../../src/modules/alt';
import type { VpnLookupResult } from '../../../src/modules/vpn/types';
import { createPlayer, createServerWithKey, useTestApp } from '../../helpers';

const NOW = '2026-09-29T12:00:00.000Z';
const SECRET = 'alt-test-ip-hash-secret';
const DAY_MS = 86_400_000;

const vpnDetected: VpnLookupResult = {
  detected: true,
  confidence: 'likely',
  type: 'vpn',
  provider: 'test-provider',
  checked: true,
};
const vpnClean: VpnLookupResult = { detected: false, confidence: 'not_detected', type: null, provider: 'test-provider', checked: true };

describe('AltService.analyze', () => {
  const t = useTestApp({ now: NOW });
  let serverId: string;
  let caseCounter = 0;

  beforeAll(async () => {
    serverId = (await createServerWithKey(t().deps)).server.id;
  });

  const service = () => new AltService({ lookbackDays: 30, maxSharedAccounts: 4 });

  function hashes(ip: string): NetworkHashes {
    return networkHashes(ip, SECRET)!;
  }

  async function seenOnNetwork(playerId: string, ip: string, lastSeen: Date, srv = serverId): Promise<void> {
    const h = hashes(ip);
    await t()
      .db.insertInto('player_network_observations')
      .values({
        player_id: playerId,
        network_hash: h.network_hash,
        prefix_hash: h.prefix_hash,
        server_id: srv,
        first_seen_at: lastSeen,
        last_seen_at: lastSeen,
        seen_count: 1,
      })
      .execute();
  }

  async function confirmedCase(playerId: string): Promise<string> {
    caseCounter += 1;
    const caseNumber = `CASE-2026-9${String(caseCounter).padStart(5, '0')}`;
    await t()
      .db.insertInto('cases')
      .values({
        case_number: caseNumber,
        player_id: playerId,
        current_verdict: 'confirmed',
        status: 'closed',
        closed_at: t().clock.now(),
        reason: 'confirmed cheating (test fixture)',
      })
      .execute();
    return caseNumber;
  }

  async function analyze(
    playerId: string,
    input: { ip?: string | null; vpn?: VpnLookupResult | null; ageDays?: number | null },
  ): Promise<AltAnalysis> {
    return withTransaction(t().db, async (tx) =>
      service().analyze(tx, {
        playerId,
        serverId,
        networkHashes: input.ip === null || input.ip === undefined ? null : hashes(input.ip),
        vpnResult: input.vpn ?? vpnClean,
        accountAgeDays: input.ageDays ?? null,
        now: t().clock.now(),
      }),
    );
  }

  it('no other players on the network → possible:false, confidence none', async () => {
    const player = await createPlayer(t().deps);
    const result = await analyze(player.id, { ip: '93.184.216.34', ageDays: 100 });
    expect(result).toEqual({ possible: false, confidence: 'none', signals: [], linked_confirmed_cases: [] });
    // The observation itself was recorded (hashes only) and upserts on repeat.
    await analyze(player.id, { ip: '93.184.216.34', ageDays: 100 });
    const obs = await t()
      .db.selectFrom('player_network_observations')
      .selectAll()
      .where('player_id', '=', player.id)
      .execute();
    expect(obs).toHaveLength(1);
    expect(obs[0]!.seen_count).toBe(2);
    expect(obs[0]!.network_hash).toBe(hashes('93.184.216.34').network_hash);
  });

  it('no ip → no correlation, no observation', async () => {
    const player = await createPlayer(t().deps);
    const result = await analyze(player.id, { ip: null, ageDays: 100 });
    expect(result.possible).toBe(false);
    expect(await t().db.selectFrom('player_network_observations').selectAll().where('player_id', '=', player.id).execute()).toHaveLength(0);
  });

  it('only prefix matches → low with same_network_prefix', async () => {
    const player = await createPlayer(t().deps);
    const neighbour = await createPlayer(t().deps);
    await seenOnNetwork(neighbour.id, '81.10.20.7', t().clock.now()); // same /24, other host
    const result = await analyze(player.id, { ip: '81.10.20.99', ageDays: 100 });
    expect(result.possible).toBe(true);
    expect(result.confidence).toBe('low');
    expect(result.signals).toEqual(['same_network_prefix']);
  });

  it('exact network match → medium with same_network_identifier', async () => {
    const player = await createPlayer(t().deps);
    const other = await createPlayer(t().deps);
    await seenOnNetwork(other.id, '82.11.22.33', t().clock.now());
    const result = await analyze(player.id, { ip: '82.11.22.33', ageDays: 100 });
    expect(result.confidence).toBe('medium');
    expect(result.signals).toContain('same_network_identifier');
    // Links recorded in both directions with the exact-match signal.
    const links = await t().db.selectFrom('player_links').selectAll().where('signal', '=', 'same_network_identifier').where('player_id', 'in', [player.id, other.id]).execute();
    const pairs = links.map((l) => `${l.player_id}->${l.linked_player_id}`);
    expect(pairs).toContain(`${player.id}->${other.id}`);
    expect(pairs).toContain(`${other.id}->${player.id}`);
  });

  it('matches outside the lookback window are ignored', async () => {
    const player = await createPlayer(t().deps);
    const stale = await createPlayer(t().deps);
    await seenOnNetwork(stale.id, '83.1.2.3', new Date(t().clock.now().getTime() - 31 * DAY_MS));
    const result = await analyze(player.id, { ip: '83.1.2.3', ageDays: 100 });
    expect(result.possible).toBe(false);
  });

  it('more than ALT_MAX_SHARED_ACCOUNTS on the network downgrades to low', async () => {
    const player = await createPlayer(t().deps);
    for (let i = 0; i < 5; i += 1) {
      const other = await createPlayer(t().deps);
      await seenOnNetwork(other.id, '84.5.6.7', t().clock.now());
    }
    const result = await analyze(player.id, { ip: '84.5.6.7', ageDays: 100 });
    expect(result.confidence).toBe('low');
    expect(result.signals).toContain('shared_network_many_accounts');
    expect(result.signals).toContain('same_network_identifier');
  });

  it('a VPN network caps confidence at low even when the high conjunction holds', async () => {
    const player = await createPlayer(t().deps);
    const other = await createPlayer(t().deps);
    await seenOnNetwork(other.id, '85.6.7.8', t().clock.now());
    const caseNumber = await confirmedCase(other.id);
    const result = await analyze(player.id, { ip: '85.6.7.8', vpn: vpnDetected, ageDays: 2 });
    expect(result.confidence).toBe('low');
    expect(result.signals).toContain('network_is_vpn');
    expect(result.linked_confirmed_cases).toEqual([caseNumber]);
  });

  it("'high' needs the full conjunction: exact + confirmed case + seen <24h + young/unknown age", async () => {
    const player = await createPlayer(t().deps);
    const other = await createPlayer(t().deps);
    await seenOnNetwork(other.id, '86.7.8.9', new Date(t().clock.now().getTime() - 3600_000));
    const caseNumber = await confirmedCase(other.id);
    const result = await analyze(player.id, { ip: '86.7.8.9', ageDays: 2 });
    expect(result.confidence).toBe('high');
    expect(result.signals).toEqual(
      expect.arrayContaining(['same_network_identifier', 'linked_account_confirmed_case', 'linked_account_recently_seen']),
    );
    expect(result.linked_confirmed_cases).toEqual([caseNumber]);
    // Unknown age also qualifies.
    expect((await analyze(player.id, { ip: '86.7.8.9', ageDays: null })).confidence).toBe('high');
  });

  it("'high' is denied when any leg of the conjunction fails", async () => {
    // Leg 1: linked account has no confirmed case.
    {
      const player = await createPlayer(t().deps);
      const other = await createPlayer(t().deps);
      await seenOnNetwork(other.id, '87.1.1.1', t().clock.now());
      expect((await analyze(player.id, { ip: '87.1.1.1', ageDays: 2 })).confidence).toBe('medium');
    }
    // Leg 2: linked account not seen within 24 h.
    {
      const player = await createPlayer(t().deps);
      const other = await createPlayer(t().deps);
      await seenOnNetwork(other.id, '87.2.2.2', new Date(t().clock.now().getTime() - 25 * 3600_000));
      await confirmedCase(other.id);
      expect((await analyze(player.id, { ip: '87.2.2.2', ageDays: 2 })).confidence).toBe('medium');
    }
    // Leg 3: this account is 7 days or older.
    {
      const player = await createPlayer(t().deps);
      const other = await createPlayer(t().deps);
      await seenOnNetwork(other.id, '87.3.3.3', t().clock.now());
      await confirmedCase(other.id);
      expect((await analyze(player.id, { ip: '87.3.3.3', ageDays: 7 })).confidence).toBe('medium');
    }
    // Leg 4: only a prefix match, no exact match.
    {
      const player = await createPlayer(t().deps);
      const other = await createPlayer(t().deps);
      await seenOnNetwork(other.id, '87.4.4.10', t().clock.now());
      await confirmedCase(other.id);
      const result = await analyze(player.id, { ip: '87.4.4.20', ageDays: 2 });
      expect(result.confidence).toBe('low');
      expect(result.signals).not.toContain('same_network_identifier');
    }
  });

  it('records player_signals rows for alt/vpn/young — detail codes only, never IPs', async () => {
    const player = await createPlayer(t().deps);
    const other = await createPlayer(t().deps);
    await seenOnNetwork(other.id, '88.9.10.11', t().clock.now());
    await analyze(player.id, { ip: '88.9.10.11', vpn: vpnDetected, ageDays: 3 });
    const signals = await t().db.selectFrom('player_signals').selectAll().where('player_id', '=', player.id).execute();
    const byType = new Map(signals.map((s) => [s.signal, s]));
    expect([...byType.keys()].sort()).toEqual(['possible_alt_account', 'vpn_detected', 'young_account']);
    expect(byType.get('possible_alt_account')).toMatchObject({ confidence: 'low', source: 'alt' }); // low: vpn cap
    expect(byType.get('possible_alt_account')!.detail_codes).toContain('network_is_vpn');
    expect(byType.get('vpn_detected')).toMatchObject({ confidence: 'likely', source: 'test-provider', detail_codes: ['vpn'] });
    expect(byType.get('young_account')).toMatchObject({ confidence: null, detail_codes: ['under_7_days'] });
    for (const signal of signals) {
      expect(JSON.stringify(signal)).not.toContain('88.9.10.11');
      for (const code of signal.detail_codes) expect(code).toMatch(/^[a-z0-9_-]{1,64}$/);
    }
  });

  it('records young_account and vpn_detected even without correlation data', async () => {
    const player = await createPlayer(t().deps);
    await analyze(player.id, { ip: null, vpn: vpnDetected, ageDays: 0 });
    const signals = await t().db.selectFrom('player_signals').select('signal').where('player_id', '=', player.id).execute();
    expect(signals.map((s) => s.signal).sort()).toEqual(['vpn_detected', 'young_account']);
  });
});
