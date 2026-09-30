/**
 * Plugin-side server lifecycle: registration (§5.2), heartbeat, key rotation (§5.5)
 * and revocation effects (§5.6).
 */
import { describe, expect, it } from 'vitest';

import { buildRegistrationPopMessage, buildRotationPopMessage } from '@scpsl-trust/shared';

import { generateEd25519KeyPair, keyFingerprint, signEd25519 } from '../../../src/lib/crypto';
import { createServerWithKey, createUser, expectError, sessionFor, signedRequest, useTestApp } from '../../helpers';

const t = useTestApp({ now: '2026-09-29T12:00:00.000Z' });

/** Creates a pending server through the web API and returns its registration token. */
async function createPendingServer(name = `Reg Test ${Math.random().toString(36).slice(2, 8)}`) {
  const deps = t().deps;
  const { user: owner } = await createUser(deps, { role: 'server_admin' });
  const session = await sessionFor(deps, owner);
  const res = await t().app.inject({
    method: 'POST',
    url: '/api/v1/servers',
    headers: session.headers,
    body: { name },
  });
  expect(res.statusCode).toBe(201);
  const body = res.json() as {
    server: { server_id: string };
    registration_token: string;
    registration_token_expires_at: string;
  };
  return { owner, session, ...body };
}

function registrationBody(token: string, overrides: Record<string, unknown> = {}) {
  const keyPair = generateEd25519KeyPair();
  const timestamp = t().clock.now().getTime();
  const pop = signEd25519(
    keyPair.privateKey,
    buildRegistrationPopMessage(token, keyPair.publicKeyB64, timestamp),
  );
  return {
    keyPair,
    body: {
      registration_token: token,
      public_key: keyPair.publicKeyB64,
      plugin_version: '1.0.0',
      game_version: '14.1.3',
      timestamp,
      pop_signature: pop,
      ...overrides,
    },
  };
}

async function register(body: unknown) {
  return t().app.inject({ method: 'POST', url: '/api/v1/servers/register', body: body as object });
}

describe('POST /servers/register', () => {
  it('registers a pending server (happy path)', async () => {
    const { server, registration_token } = await createPendingServer();
    const { keyPair, body } = registrationBody(registration_token);
    const res = await register(body);
    expect(res.statusCode).toBe(201);
    const json = res.json();
    expect(json).toMatchObject({
      server_id: server.server_id,
      key_fingerprint: keyFingerprint(keyPair.publicKeyB64),
      status: 'active',
    });
    expect(json.server_time).toBe(t().clock.now().toISOString());

    const row = await t()
      .db.selectFrom('servers')
      .selectAll()
      .where('server_id', '=', server.server_id)
      .executeTakeFirstOrThrow();
    expect(row.status).toBe('active');
    expect(row.registered_at).not.toBeNull();
    expect(row.plugin_version).toBe('1.0.0');

    // Default policy v1 materialized.
    const policy = await t()
      .db.selectFrom('server_policies')
      .selectAll()
      .where('server_id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(policy.version).toBe(1);
    expect(policy.is_active).toBe(true);
    const rules = await t().db.selectFrom('server_policy_rules').selectAll().where('policy_id', '=', policy.id).execute();
    expect(rules).toHaveLength(4);

    // Token single use.
    const token = await t()
      .db.selectFrom('server_registration_tokens')
      .selectAll()
      .where('server_id', '=', row.id)
      .executeTakeFirstOrThrow();
    expect(token.used_at).not.toBeNull();

    // Audit SERVER_REGISTERED by the server actor, inside the tx.
    const audit = await t()
      .db.selectFrom('audit_events')
      .selectAll()
      .where('action', '=', 'SERVER_REGISTERED')
      .executeTakeFirstOrThrow();
    expect(audit.actor_type).toBe('server');
    expect(audit.actor_id).toBe(server.server_id);
    expect(audit.server_id).toBe(row.id);
  });

  it('rejects an unknown token', async () => {
    const { body } = registrationBody('sreg_' + 'a'.repeat(43));
    expectError(await register(body), 400, 'REGISTRATION_TOKEN_INVALID');
  });

  it('rejects a used token (register twice)', async () => {
    const { registration_token } = await createPendingServer();
    expect((await register(registrationBody(registration_token).body)).statusCode).toBe(201);
    expectError(await register(registrationBody(registration_token).body), 400, 'REGISTRATION_TOKEN_INVALID');
  });

  it('rejects an expired token', async () => {
    const { registration_token } = await createPendingServer();
    t().clock.advance(25 * 3600 * 1000); // TTL 24 h
    expectError(await register(registrationBody(registration_token).body), 400, 'REGISTRATION_TOKEN_INVALID');
  });

  it('rejects a revoked token (superseded by a newer one)', async () => {
    const { server, session, registration_token } = await createPendingServer();
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/servers/${server.server_id}/registration-token`,
      headers: session.headers,
    });
    expect(res.statusCode).toBe(201);
    const fresh = res.json() as { registration_token: string };
    expect(fresh.registration_token).not.toBe(registration_token);
    // Old token is revoked...
    expectError(await register(registrationBody(registration_token).body), 400, 'REGISTRATION_TOKEN_INVALID');
    // ...the new one works.
    expect((await register(registrationBody(fresh.registration_token).body)).statusCode).toBe(201);
  });

  it('rejects a bad PoP signature', async () => {
    const { registration_token } = await createPendingServer();
    const other = generateEd25519KeyPair();
    const { body } = registrationBody(registration_token, {
      pop_signature: signEd25519(
        other.privateKey,
        buildRegistrationPopMessage(registration_token, other.publicKeyB64, t().clock.now().getTime()),
      ),
    });
    expectError(await register(body), 400, 'PROOF_OF_POSSESSION_INVALID');
  });

  it('rejects a PoP over a different token', async () => {
    const a = await createPendingServer();
    const b = await createPendingServer();
    const prep = registrationBody(b.registration_token);
    // PoP signed for token B but submitted with token A.
    const body = { ...prep.body, registration_token: a.registration_token };
    expectError(await register(body), 400, 'PROOF_OF_POSSESSION_INVALID');
  });

  it('rejects timestamp skew beyond 300 s', async () => {
    const { registration_token } = await createPendingServer();
    const keyPair = generateEd25519KeyPair();
    const timestamp = t().clock.now().getTime() - 301_000;
    const body = {
      registration_token,
      public_key: keyPair.publicKeyB64,
      plugin_version: '1.0.0',
      timestamp,
      pop_signature: signEd25519(
        keyPair.privateKey,
        buildRegistrationPopMessage(registration_token, keyPair.publicKeyB64, timestamp),
      ),
    };
    expectError(await register(body), 400, 'INVALID_TIMESTAMP');
  });

  it('rejects a duplicate fingerprint', async () => {
    const identity = await createServerWithKey(t().deps);
    const { registration_token } = await createPendingServer();
    const timestamp = t().clock.now().getTime();
    const body = {
      registration_token,
      public_key: identity.keyPair.publicKeyB64,
      plugin_version: '1.0.0',
      timestamp,
      pop_signature: signEd25519(
        identity.keyPair.privateKey,
        buildRegistrationPopMessage(registration_token, identity.keyPair.publicKeyB64, timestamp),
      ),
    };
    expectError(await register(body), 409, 'ALREADY_EXISTS');
  });

  it('rejects re-registration of a server with an active key', async () => {
    const identity = await createServerWithKey(t().deps);
    // Issue a fresh token for the already-registered server directly.
    const { user } = await createUser(t().deps, { role: 'admin', totp: true });
    const session = await sessionFor(t().deps, user, { mfa_verified: true });
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/servers/${identity.server.server_id}/registration-token`,
      headers: session.headers,
    });
    expect(res.statusCode).toBe(201);
    const { registration_token } = res.json() as { registration_token: string };
    expectError(await register(registrationBody(registration_token).body), 409, 'ALREADY_EXISTS');
  });
});

describe('POST /servers/heartbeat', () => {
  it('updates versions/last_seen and reports policy + rotation flag', async () => {
    const identity = await createServerWithKey(t().deps);
    const res = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/servers/heartbeat',
      body: { plugin_version: '1.2.3', game_version: '14.2.0', player_count: 17 },
      pluginVersion: '1.2.3',
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      status: 'active',
      policy_version: null, // factory servers have no policy yet
      key_rotation_requested: false,
      server_time: t().clock.now().toISOString(),
    });
    const row = await t()
      .db.selectFrom('servers')
      .selectAll()
      .where('id', '=', identity.server.id)
      .executeTakeFirstOrThrow();
    expect(row.plugin_version).toBe('1.2.3');
    expect(row.game_version).toBe('14.2.0');
    expect(row.last_seen_at?.toISOString()).toBe(t().clock.now().toISOString());
  });

  it('surfaces a web rotation request', async () => {
    const identity = await createServerWithKey(t().deps);
    const owner = identity.owner;
    const session = await sessionFor(t().deps, owner);
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/servers/${identity.server.server_id}/keys/rotation-request`,
      headers: session.headers,
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { key_rotation_requested_at: string }).key_rotation_requested_at).toBe(
      t().clock.now().toISOString(),
    );
    const hb = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/servers/heartbeat',
      body: { plugin_version: '1.0.0' },
    });
    expect(hb.statusCode).toBe(200);
    expect((hb.json() as { key_rotation_requested: boolean }).key_rotation_requested).toBe(true);
  });
});

describe('POST /servers/keys/rotate', () => {
  function rotateBody(serverId: string, newKeyPair = generateEd25519KeyPair(), signer = newKeyPair) {
    const timestamp = t().clock.now().getTime();
    return {
      newKeyPair,
      body: {
        new_public_key: newKeyPair.publicKeyB64,
        timestamp,
        pop_signature: signEd25519(
          signer.privateKey,
          buildRotationPopMessage(serverId, newKeyPair.publicKeyB64, timestamp),
        ),
      },
    };
  }

  it('rotates: new key active, old key retiring; grace window honored', async () => {
    const identity = await createServerWithKey(t().deps);
    const { newKeyPair, body } = rotateBody(identity.server.server_id);
    const res = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/servers/keys/rotate',
      body,
    });
    expect(res.statusCode).toBe(200);
    const json = res.json() as Record<string, string>;
    expect(json.key_fingerprint).toBe(keyFingerprint(newKeyPair.publicKeyB64));
    expect(json.previous_key_fingerprint).toBe(identity.fingerprint);

    const audit = await t()
      .db.selectFrom('audit_events')
      .select(['actor_type', 'actor_id'])
      .where('action', '=', 'SERVER_KEY_ROTATED')
      .executeTakeFirstOrThrow();
    expect(audit.actor_id).toBe(identity.server.server_id);

    // Old key still works within grace (600 s default).
    t().clock.advanceSeconds(30);
    const oldOk = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/servers/heartbeat',
      body: { plugin_version: '1.0.0' },
    });
    expect(oldOk.statusCode).toBe(200);

    // New key works.
    const newIdentity = {
      server: identity.server,
      keyPair: newKeyPair,
      fingerprint: keyFingerprint(newKeyPair.publicKeyB64),
    };
    const newOk = await signedRequest(t().app, newIdentity, {
      method: 'POST',
      url: '/api/v1/servers/heartbeat',
      body: { plugin_version: '1.0.0' },
    });
    expect(newOk.statusCode).toBe(200);

    // Old key fails after grace.
    t().clock.advanceSeconds(600);
    const oldExpired = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/servers/heartbeat',
      body: { plugin_version: '1.0.0' },
    });
    expectError(oldExpired, 401, 'NO_ACTIVE_KEY');
  });

  it('clears key_rotation_requested_at', async () => {
    const identity = await createServerWithKey(t().deps);
    await t()
      .db.updateTable('servers')
      .set({ key_rotation_requested_at: t().clock.now() })
      .where('id', '=', identity.server.id)
      .execute();
    const { body } = rotateBody(identity.server.server_id);
    const res = await signedRequest(t().app, identity, { method: 'POST', url: '/api/v1/servers/keys/rotate', body });
    expect(res.statusCode).toBe(200);
    const row = await t()
      .db.selectFrom('servers')
      .select('key_rotation_requested_at')
      .where('id', '=', identity.server.id)
      .executeTakeFirstOrThrow();
    expect(row.key_rotation_requested_at).toBeNull();
  });

  it('rejects PoP signed by the OLD key', async () => {
    const identity = await createServerWithKey(t().deps);
    const { body } = rotateBody(identity.server.server_id, generateEd25519KeyPair(), identity.keyPair);
    const res = await signedRequest(t().app, identity, { method: 'POST', url: '/api/v1/servers/keys/rotate', body });
    expectError(res, 400, 'PROOF_OF_POSSESSION_INVALID');
  });

  it('rejects rotation timestamp outside 300 s', async () => {
    const identity = await createServerWithKey(t().deps);
    const newKeyPair = generateEd25519KeyPair();
    const timestamp = t().clock.now().getTime() + 301_000;
    const res = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/servers/keys/rotate',
      body: {
        new_public_key: newKeyPair.publicKeyB64,
        timestamp,
        pop_signature: signEd25519(
          newKeyPair.privateKey,
          buildRotationPopMessage(identity.server.server_id, newKeyPair.publicKeyB64, timestamp),
        ),
      },
    });
    expectError(res, 400, 'INVALID_TIMESTAMP');
  });

  it('the retiring key may not rotate again', async () => {
    const identity = await createServerWithKey(t().deps);
    const first = rotateBody(identity.server.server_id);
    expect(
      (await signedRequest(t().app, identity, { method: 'POST', url: '/api/v1/servers/keys/rotate', body: first.body }))
        .statusCode,
    ).toBe(200);
    // Within grace the old key still signs requests, but rotation must be refused.
    const second = rotateBody(identity.server.server_id);
    const res = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/servers/keys/rotate',
      body: second.body,
    });
    expectError(res, 403, 'FORBIDDEN');
  });

  it('rejects rotating to an already-used public key', async () => {
    const identity = await createServerWithKey(t().deps);
    const { body } = rotateBody(identity.server.server_id, identity.keyPair, identity.keyPair);
    const res = await signedRequest(t().app, identity, { method: 'POST', url: '/api/v1/servers/keys/rotate', body });
    expectError(res, 409, 'ALREADY_EXISTS');
  });
});

describe('key revocation (§5.6)', () => {
  it('web revoke → signed plugin requests fail KEY_REVOKED', async () => {
    const identity = await createServerWithKey(t().deps);
    const session = await sessionFor(t().deps, identity.owner);
    const keyRow = await t()
      .db.selectFrom('server_keys')
      .select('id')
      .where('server_id', '=', identity.server.id)
      .executeTakeFirstOrThrow();
    const res = await t().app.inject({
      method: 'POST',
      url: `/api/v1/servers/${identity.server.server_id}/keys/${keyRow.id}/revoke`,
      headers: session.headers,
      body: { reason: 'compromised host' },
    });
    expect(res.statusCode).toBe(200);

    const audit = await t()
      .db.selectFrom('audit_events')
      .select(['action'])
      .where('action', '=', 'SERVER_KEY_REVOKED')
      .execute();
    expect(audit).toHaveLength(1);

    const plugin = await signedRequest(t().app, identity, {
      method: 'POST',
      url: '/api/v1/servers/heartbeat',
      body: { plugin_version: '1.0.0' },
    });
    expectError(plugin, 401, 'KEY_REVOKED');
  });
});
