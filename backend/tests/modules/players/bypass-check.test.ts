/**
 * POST /api/v1/player/bypass/check (§6.2): server-scoped vs other server vs
 * global with/without honor_global_bypasses, types filter, expiry/revocation,
 * winner selection.
 */
import { describe, expect, it } from 'vitest';

import type { Deps } from '../../../src/container';
import { createPlayer, createServerWithKey, createUser, expectError, randomSteamId, signedRequest, useTestApp } from '../../helpers';

const NOW = '2026-09-29T12:00:00.000Z';

type Identity = Awaited<ReturnType<typeof createServerWithKey>>;

async function bypassCheck(app: unknown, identity: Identity, body: Record<string, unknown>) {
  return signedRequest(app as never, identity, { method: 'POST', url: '/api/v1/player/bypass/check', body });
}

async function grant(
  deps: Deps,
  playerId: string,
  granterId: string,
  opts: { scope: 'server' | 'global'; serverId?: string | null; type?: string; expiresAt?: Date | null; revoked?: boolean },
) {
  await deps.db
    .insertInto('bypasses')
    .values({
      player_id: playerId,
      scope: opts.scope,
      server_id: opts.serverId ?? null,
      type: (opts.type ?? 'vpn_whitelist') as 'vpn_whitelist',
      reason: 'test bypass',
      granted_by_user_id: granterId,
      expires_at: opts.expiresAt ?? null,
      revoked_at: opts.revoked === true ? deps.clock.now() : null,
      revoked_by: opts.revoked === true ? granterId : null,
      revoke_reason: opts.revoked === true ? 'revoked' : null,
    })
    .execute();
}

describe('POST /api/v1/player/bypass/check', () => {
  const t = useTestApp({ now: NOW });

  async function setup() {
    const granter = (await createUser(t().deps, { role: 'admin' })).user;
    const player = await createPlayer(t().deps);
    const mine = await createServerWithKey(t().deps);
    const other = await createServerWithKey(t().deps);
    const ref = { type: player.id_type, id: player.external_id };
    return { granter, player, mine, other, ref };
  }

  it('sees server-scoped bypasses of its own server only', async () => {
    const { granter, player, mine, other, ref } = await setup();
    await grant(t().deps, player.id, granter.id, { scope: 'server', serverId: mine.server.id });
    await grant(t().deps, player.id, granter.id, { scope: 'server', serverId: other.server.id, type: 'account_age_whitelist' });

    const fromMine = (await bypassCheck(t().app, mine, { player: ref })).json();
    expect(fromMine).toMatchObject({ vpn: false, bypass: true, bypass_type: 'vpn_whitelist', expires_at: null });
    expect(fromMine.bypasses).toHaveLength(1);
    expect(fromMine.bypasses[0]).toMatchObject({ type: 'vpn_whitelist', scope: 'server' });

    const fromOther = (await bypassCheck(t().app, other, { player: ref })).json();
    expect(fromOther.bypasses).toHaveLength(1);
    expect(fromOther.bypass_type).toBe('account_age_whitelist');
  });

  it('honors global bypasses only when the active policy says so', async () => {
    const { granter, player, mine, ref } = await setup();
    await grant(t().deps, player.id, granter.id, { scope: 'global', type: 'verdict_override' });

    const withoutHonor = (await bypassCheck(t().app, mine, { player: ref })).json();
    expect(withoutHonor).toMatchObject({ bypass: false, bypass_type: null, expires_at: null, bypasses: [] });

    await t()
      .db.insertInto('server_policies')
      .values({ server_id: mine.server.id, version: 1, is_active: true, honor_global_bypasses: true })
      .execute();
    const withHonor = (await bypassCheck(t().app, mine, { player: ref })).json();
    expect(withHonor).toMatchObject({ bypass: true, bypass_type: 'verdict_override' });
    expect(withHonor.bypasses[0]).toMatchObject({ scope: 'global' });
  });

  it('filters by requested types', async () => {
    const { granter, player, mine, ref } = await setup();
    await grant(t().deps, player.id, granter.id, { scope: 'server', serverId: mine.server.id, type: 'vpn_whitelist' });
    await grant(t().deps, player.id, granter.id, { scope: 'server', serverId: mine.server.id, type: 'alt_account_whitelist' });

    const filtered = (await bypassCheck(t().app, mine, { player: ref, types: ['alt_account_whitelist'] })).json();
    expect(filtered.bypasses).toHaveLength(1);
    expect(filtered.bypass_type).toBe('alt_account_whitelist');

    const none = (await bypassCheck(t().app, mine, { player: ref, types: ['verdict_override'] })).json();
    expect(none).toMatchObject({ bypass: false, bypass_type: null, bypasses: [] });

    const duplicate = await bypassCheck(t().app, mine, { player: ref, types: ['vpn_whitelist', 'vpn_whitelist'] });
    expectError(duplicate, 400, 'VALIDATION_FAILED');
  });

  it('ignores expired and revoked bypasses', async () => {
    const { granter, player, mine, ref } = await setup();
    await grant(t().deps, player.id, granter.id, {
      scope: 'server',
      serverId: mine.server.id,
      expiresAt: new Date(t().clock.now().getTime() - 1000),
    });
    await grant(t().deps, player.id, granter.id, { scope: 'server', serverId: mine.server.id, type: 'alt_account_whitelist', revoked: true });
    const body = (await bypassCheck(t().app, mine, { player: ref })).json();
    expect(body).toMatchObject({ bypass: false, bypasses: [] });
  });

  it('the winning bypass has the latest expiry; no expiry wins outright', async () => {
    const { granter, player, mine, ref } = await setup();
    const soon = new Date(t().clock.now().getTime() + 3600_000);
    const later = new Date(t().clock.now().getTime() + 7200_000);
    await grant(t().deps, player.id, granter.id, { scope: 'server', serverId: mine.server.id, type: 'vpn_whitelist', expiresAt: soon });
    await grant(t().deps, player.id, granter.id, { scope: 'server', serverId: mine.server.id, type: 'account_age_whitelist', expiresAt: later });
    const timed = (await bypassCheck(t().app, mine, { player: ref })).json();
    expect(timed.bypass_type).toBe('account_age_whitelist');
    expect(timed.expires_at).toBe(later.toISOString());
    expect(timed.bypasses).toHaveLength(2);

    await grant(t().deps, player.id, granter.id, { scope: 'server', serverId: mine.server.id, type: 'alt_account_whitelist', expiresAt: null });
    const permanent = (await bypassCheck(t().app, mine, { player: ref })).json();
    expect(permanent.bypass_type).toBe('alt_account_whitelist');
    expect(permanent.expires_at).toBeNull();
  });

  it('answers cleanly for a player the network has never seen', async () => {
    const mine = await createServerWithKey(t().deps);
    const body = (await bypassCheck(t().app, mine, { player: { type: 'steam', id: randomSteamId() } })).json();
    expect(body).toEqual({ vpn: false, bypass: false, bypass_type: null, expires_at: null, bypasses: [] });
  });

  it('requires a valid signature', async () => {
    const res = await t().app.inject({
      method: 'POST',
      url: '/api/v1/player/bypass/check',
      payload: { player: { type: 'steam', id: randomSteamId() } },
    });
    expect(res.statusCode).toBe(401);
  });
});
