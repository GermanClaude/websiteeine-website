/**
 * Builds shared/test-vectors/signing.json (ARCHITECTURE §5.2, §5.3, §5.5).
 */
import {
  buildCanonicalRequest,
  buildRegistrationPopMessage,
  buildRotationPopMessage,
  SIGNING_HEADERS,
  SIGNING_VERSION,
} from '../../src/signing';
import {
  base64Url,
  fixtureBytes,
  keyFingerprint,
  privateKeyFromSeed,
  publicKeyFromRaw,
  rawPublicKey,
  sha256Hex,
  signEd25519,
  verifyEd25519,
} from './node-crypto';
import type {
  KeyVector,
  PopNegativeVector,
  SignedRequestInputs,
  SigningNegativeVector,
  SigningRequestVector,
  SigningVectors,
} from './types';

const SERVER_ID = 'srv_7k4x92m8pq174kf9';
const OTHER_SERVER_ID = 'srv_0000000000000001';
const PLUGIN_VERSION = '1.0.0';
const BASE_TIMESTAMP_MS = 1_790_000_000_000;

/** TEST ONLY seeds: bytes 0x00..0x1f and 0x20..0x3f. */
export const PRIMARY_SEED = Buffer.from(Array.from({ length: 32 }, (_, i) => i));
export const ROTATION_SEED = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x20 + i));

const RFC8032_TEST_1 = {
  seed_hex: '9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60',
  public_key_hex: 'd75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a',
  message_hex: '',
  signature_hex:
    'e5564300c360ac729086e2cc806e828a84877f1eb8e5d974d873e065224901555fb8821590a33bacc61e39701cf9b46bd25bf5f0595bbe24655141438e7a100b',
};

function keyVector(seed: Buffer): KeyVector {
  const raw = rawPublicKey(privateKeyFromSeed(seed));
  return {
    seed_hex: seed.toString('hex'),
    public_key_hex: raw.toString('hex'),
    public_key_b64: raw.toString('base64'),
    fingerprint: keyFingerprint(raw),
  };
}

function nonce(label: string): string {
  // 18 bytes → 24 base64url characters, like the plugin.
  return base64Url(fixtureBytes(`nonce:${label}`, 18));
}

interface RequestSpec {
  name: string;
  description: string;
  method: string;
  path_with_query: string;
  body: string;
  timestampOffsetMs: number;
  request_id: string;
  includeFingerprint: boolean;
  serverId?: string;
}

function inputsFor(spec: Omit<RequestSpec, 'name' | 'description' | 'includeFingerprint'>): SignedRequestInputs {
  const bodyBytes = Buffer.from(spec.body, 'utf8');
  return {
    method: spec.method,
    path_with_query: spec.path_with_query,
    server_id: spec.serverId ?? SERVER_ID,
    timestamp: String(BASE_TIMESTAMP_MS + spec.timestampOffsetMs),
    nonce: nonce(spec.request_id),
    request_id: spec.request_id,
    body: spec.body,
    body_base64: bodyBytes.toString('base64'),
    body_sha256_hex: sha256Hex(bodyBytes),
  };
}

function pickInputs(vector: SignedRequestInputs): SignedRequestInputs {
  return {
    method: vector.method,
    path_with_query: vector.path_with_query,
    server_id: vector.server_id,
    timestamp: vector.timestamp,
    nonce: vector.nonce,
    request_id: vector.request_id,
    body: vector.body,
    body_base64: vector.body_base64,
    body_sha256_hex: vector.body_sha256_hex,
  };
}

function canonicalFor(inputs: SignedRequestInputs): string {
  return buildCanonicalRequest({
    method: inputs.method,
    pathWithQuery: inputs.path_with_query,
    serverId: inputs.server_id,
    timestamp: inputs.timestamp,
    nonce: inputs.nonce,
    requestId: inputs.request_id,
    bodySha256Hex: inputs.body_sha256_hex,
  });
}

/** Independent re-implementation of §5.3 used to cross-check the shared builder. */
function manualCanonical(inputs: SignedRequestInputs): string {
  return `${SIGNING_VERSION}\n${inputs.method.toUpperCase()}\n${inputs.path_with_query}\n${inputs.server_id}\n${inputs.timestamp}\n${inputs.nonce}\n${inputs.request_id}\n${inputs.body_sha256_hex}`;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`signing vectors: ${message}`);
}

export function buildSigningVectors(): SigningVectors {
  const primaryKey = privateKeyFromSeed(PRIMARY_SEED);
  const rotationKey = privateKeyFromSeed(ROTATION_SEED);
  const primary = keyVector(PRIMARY_SEED);
  const rotation = keyVector(ROTATION_SEED);
  const primaryPublic = publicKeyFromRaw(Buffer.from(primary.public_key_hex, 'hex'));
  const rotationPublic = publicKeyFromRaw(Buffer.from(rotation.public_key_hex, 'hex'));

  // Known-answer check of the Node conversion helpers against RFC 8032 §7.1 TEST 1.
  const rfcKey = privateKeyFromSeed(Buffer.from(RFC8032_TEST_1.seed_hex, 'hex'));
  assert(rawPublicKey(rfcKey).toString('hex') === RFC8032_TEST_1.public_key_hex, 'RFC 8032 public key mismatch');
  assert(signEd25519(rfcKey, Buffer.alloc(0)).toString('hex') === RFC8032_TEST_1.signature_hex, 'RFC 8032 signature mismatch');

  // Rotation PoP (also used as the body of the signed rotate request).
  const rotationTimestamp = BASE_TIMESTAMP_MS + 60_000;
  const rotationMessage = buildRotationPopMessage(SERVER_ID, rotation.public_key_b64, rotationTimestamp);
  const rotationPopSignature = signEd25519(rotationKey, rotationMessage).toString('base64');
  const rotateBody = JSON.stringify({
    new_public_key: rotation.public_key_b64,
    timestamp: rotationTimestamp,
    pop_signature: rotationPopSignature,
  });

  const specs: RequestSpec[] = [
    {
      name: 'get_policy_no_query',
      description: 'GET without query string and without body; X-Key-Fingerprint omitted (optional header).',
      method: 'GET',
      path_with_query: '/api/v1/servers/policy',
      body: '',
      timestampOffsetMs: 0,
      request_id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      includeFingerprint: false,
    },
    {
      name: 'get_policy_with_query',
      description: 'GET with a percent-encoded query string; the path is signed exactly as sent (no decoding, no reordering).',
      method: 'GET',
      path_with_query: '/api/v1/servers/policy?include=rules&note=%C3%A4%20b&x=1',
      body: '',
      timestampOffsetMs: 1_000,
      request_id: '6fa459ea-ee8a-4ca4-894e-db77e160355e',
      includeFingerprint: true,
    },
    {
      name: 'post_player_check',
      description: 'POST with a compact JSON body.',
      method: 'POST',
      path_with_query: '/api/v1/player/check',
      body: JSON.stringify({
        server_id: SERVER_ID,
        player: { type: 'steam', id: '76561198000000001' },
        nickname: 'Foo',
        ip: '203.0.113.4',
      }),
      timestampOffsetMs: 2_000,
      request_id: '9b2e7c1a-5d3f-4e8b-a1c2-7f6e5d4c3b2a',
      includeFingerprint: true,
    },
    {
      name: 'post_server_report_unicode',
      description: 'POST whose body contains non-ASCII characters (umlauts, CJK, emoji, escaped quotes); the hash is over the UTF-8 bytes.',
      method: 'POST',
      path_with_query: '/api/v1/server/reports',
      body: JSON.stringify({
        player: { type: 'steam', id: '76561198000000001' },
        reporter: { type: 'discord', id: '123456789012345678' },
        reason: 'Aimbot \u{1F3AF} — Grüße',
        description: '日本語 ✓ "quoted" \\ backslash',
      }),
      timestampOffsetMs: 3_000,
      request_id: 'c1d2e3f4-a5b6-4c7d-8e9f-0a1b2c3d4e5f',
      includeFingerprint: true,
    },
    {
      name: 'post_heartbeat_pretty_body',
      description: 'POST with pretty-printed JSON (newlines, spaces): raw bytes are hashed, never a re-serialization.',
      method: 'POST',
      path_with_query: '/api/v1/servers/heartbeat',
      body: '{\n  "plugin_version": "1.0.0",\n  "game_version": "14.1.3",\n  "player_count": 17\n}\n',
      timestampOffsetMs: 4_000,
      request_id: '0e8a3d52-6b1f-4c9a-9d7e-2f4b6a8c0e1d',
      includeFingerprint: true,
    },
    {
      name: 'post_overwatch_heartbeat_empty_body',
      description: 'POST with an empty body: body hash is SHA-256 of the empty string.',
      method: 'POST',
      path_with_query: '/api/v1/overwatch/sessions/5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e/heartbeat',
      body: '',
      timestampOffsetMs: 5_000,
      request_id: 'a7b8c9d0-e1f2-4a3b-8c4d-5e6f7a8b9c0d',
      includeFingerprint: true,
    },
    {
      name: 'put_lowercase_method',
      description: 'PUT supplied in lower case: the canonical string upper-cases the method.',
      method: 'put',
      path_with_query: '/api/v1/servers/policy',
      body: '{"example":true}',
      timestampOffsetMs: 6_000,
      request_id: 'd4c3b2a1-f6e5-4d7c-b8a9-0f1e2d3c4b5a',
      includeFingerprint: true,
    },
    {
      name: 'post_key_rotate',
      description: 'Key rotation request, signed with the CURRENT key; the body carries the PoP of the NEW key (see rotation_pop).',
      method: 'POST',
      path_with_query: '/api/v1/servers/keys/rotate',
      body: rotateBody,
      timestampOffsetMs: 60_000,
      request_id: 'f0e1d2c3-b4a5-4968-8776-655443322110',
      includeFingerprint: true,
    },
  ];

  const requests: SigningRequestVector[] = specs.map((spec) => {
    const inputs = inputsFor(spec);
    const canonical = canonicalFor(inputs);
    assert(canonical === manualCanonical(inputs), `canonical mismatch for ${spec.name}`);
    const signature = signEd25519(primaryKey, canonical);
    assert(verifyEd25519(primaryPublic, canonical, signature), `self-verification failed for ${spec.name}`);
    const headers: Record<string, string> = {
      [SIGNING_HEADERS.SERVER_ID]: inputs.server_id,
      [SIGNING_HEADERS.TIMESTAMP]: inputs.timestamp,
      [SIGNING_HEADERS.NONCE]: inputs.nonce,
      [SIGNING_HEADERS.REQUEST_ID]: inputs.request_id,
      [SIGNING_HEADERS.PLUGIN_VERSION]: PLUGIN_VERSION,
      [SIGNING_HEADERS.SIGNATURE]: signature.toString('base64'),
    };
    if (spec.includeFingerprint) headers[SIGNING_HEADERS.KEY_FINGERPRINT] = primary.fingerprint;
    return {
      name: spec.name,
      description: spec.description,
      ...inputs,
      canonical,
      signature_b64: signature.toString('base64'),
      headers,
    };
  });

  const byName = (name: string): SigningRequestVector => {
    const found = requests.find((request) => request.name === name);
    if (found === undefined) throw new Error(`unknown request ${name}`);
    return found;
  };

  const negative: SigningNegativeVector[] = [];
  const addNegative = (
    name: string,
    description: string,
    basedOn: string,
    mutate: (inputs: SignedRequestInputs) => SignedRequestInputs,
    signatureOverride?: string,
    publicKeyB64: string = primary.public_key_b64,
  ): void => {
    const original = byName(basedOn);
    const tampered = mutate(pickInputs(original));
    const bodyBytes = Buffer.from(tampered.body, 'utf8');
    const inputs: SignedRequestInputs = {
      ...tampered,
      body_base64: bodyBytes.toString('base64'),
      body_sha256_hex: sha256Hex(bodyBytes),
    };
    const canonical = canonicalFor(inputs);
    const signature = signatureOverride ?? original.signature_b64;
    const verifyKey = publicKeyFromRaw(Buffer.from(publicKeyB64, 'base64'));
    assert(!verifyEd25519(verifyKey, canonical, Buffer.from(signature, 'base64')), `negative ${name} verified`);
    negative.push({
      name,
      description,
      based_on: basedOn,
      ...inputs,
      canonical,
      signature_b64: signature,
      public_key_b64: publicKeyB64,
      expected_valid: false,
    });
  };

  addNegative('tampered_body', 'Player id in the body changed.', 'post_player_check', (r) => ({
    ...r,
    body: r.body.replace('76561198000000001', '76561198000000002'),
  }));
  addNegative('tampered_body_whitespace', 'Semantically equal JSON with one extra space (bytes differ).', 'post_player_check', (r) => ({
    ...r,
    body: r.body.replace('{"server_id"', '{ "server_id"'),
  }));
  addNegative('tampered_body_removed', 'Body dropped entirely (empty-body hash).', 'post_player_check', (r) => ({
    ...r,
    body: '',
  }));
  addNegative('tampered_path', 'Request replayed against another endpoint.', 'post_player_check', (r) => ({
    ...r,
    path_with_query: '/api/v1/player/bypass/check',
  }));
  addNegative('tampered_query', 'Query parameter value changed.', 'get_policy_with_query', (r) => ({
    ...r,
    path_with_query: r.path_with_query.replace('include=rules', 'include=all'),
  }));
  addNegative('tampered_query_order', 'Query parameters reordered (the path is signed verbatim).', 'get_policy_with_query', (r) => ({
    ...r,
    path_with_query: '/api/v1/servers/policy?x=1&include=rules&note=%C3%A4%20b',
  }));
  addNegative('tampered_query_decoded', 'Query string percent-decoded before verification.', 'get_policy_with_query', (r) => ({
    ...r,
    path_with_query: '/api/v1/servers/policy?include=rules&note=ä%20b&x=1',
  }));
  addNegative('tampered_timestamp', 'Timestamp shifted by 1 ms.', 'post_player_check', (r) => ({
    ...r,
    timestamp: String(Number(r.timestamp) + 1),
  }));
  addNegative('tampered_nonce', 'Nonce replaced.', 'post_player_check', (r) => ({
    ...r,
    nonce: nonce('tampered'),
  }));
  addNegative('tampered_request_id', 'Request id replaced.', 'post_player_check', (r) => ({
    ...r,
    request_id: '11111111-2222-4333-8444-555555555555',
  }));
  addNegative('tampered_method', 'POST replayed as PUT.', 'post_player_check', (r) => ({ ...r, method: 'PUT' }));
  addNegative('tampered_server_id', 'Signature presented for another server id.', 'post_player_check', (r) => ({
    ...r,
    server_id: OTHER_SERVER_ID,
  }));
  addNegative('empty_body_replaced', 'Empty-body request given a body.', 'post_overwatch_heartbeat_empty_body', (r) => ({
    ...r,
    body: '{}',
  }));

  const post = byName('post_player_check');
  addNegative(
    'wrong_key',
    'Correct canonical string signed by the rotation key but verified with the primary key.',
    'post_player_check',
    (r) => r,
    signEd25519(rotationKey, post.canonical).toString('base64'),
  );
  const flipped = Buffer.from(post.signature_b64, 'base64');
  flipped[10] = (flipped[10] ?? 0) ^ 0x01;
  addNegative('signature_bit_flip', 'One bit of the signature flipped.', 'post_player_check', (r) => r, flipped.toString('base64'));

  // Registration PoP (primary key is the key being registered).
  const registrationToken = `sreg_${base64Url(fixtureBytes('registration-token', 32))}`;
  const registrationMessage = buildRegistrationPopMessage(registrationToken, primary.public_key_b64, BASE_TIMESTAMP_MS);
  const registrationSignature = signEd25519(primaryKey, registrationMessage).toString('base64');
  assert(
    verifyEd25519(primaryPublic, registrationMessage, Buffer.from(registrationSignature, 'base64')),
    'registration PoP self-verification failed',
  );
  assert(
    verifyEd25519(rotationPublic, rotationMessage, Buffer.from(rotationPopSignature, 'base64')),
    'rotation PoP self-verification failed',
  );

  const popNegative: PopNegativeVector[] = [
    {
      name: 'registration_other_token',
      description: 'Registration PoP presented with a different registration token.',
      message: buildRegistrationPopMessage(`sreg_${base64Url(fixtureBytes('other-token', 32))}`, primary.public_key_b64, BASE_TIMESTAMP_MS),
      signature_b64: registrationSignature,
      public_key_b64: primary.public_key_b64,
      expected_valid: false,
    },
    {
      name: 'registration_other_timestamp',
      description: 'Registration PoP presented with a different timestamp.',
      message: buildRegistrationPopMessage(registrationToken, primary.public_key_b64, BASE_TIMESTAMP_MS + 1),
      signature_b64: registrationSignature,
      public_key_b64: primary.public_key_b64,
      expected_valid: false,
    },
    {
      name: 'rotation_signed_by_old_key',
      description: 'Rotation PoP must be signed by the NEW key; a signature by the current key fails.',
      message: rotationMessage,
      signature_b64: signEd25519(primaryKey, rotationMessage).toString('base64'),
      public_key_b64: rotation.public_key_b64,
      expected_valid: false,
    },
    {
      name: 'rotation_other_server',
      description: 'Rotation PoP replayed for another server id.',
      message: buildRotationPopMessage(OTHER_SERVER_ID, rotation.public_key_b64, rotationTimestamp),
      signature_b64: rotationPopSignature,
      public_key_b64: rotation.public_key_b64,
      expected_valid: false,
    },
  ];
  for (const vector of popNegative) {
    const key = publicKeyFromRaw(Buffer.from(vector.public_key_b64, 'base64'));
    assert(!verifyEd25519(key, vector.message, Buffer.from(vector.signature_b64, 'base64')), `pop negative ${vector.name} verified`);
  }

  return {
    version: SIGNING_VERSION,
    description:
      'Ed25519 request signing vectors (ARCHITECTURE §5). Seeds are TEST ONLY. Ed25519 is deterministic, so signatures must match byte-for-byte.',
    rfc8032_test_1: RFC8032_TEST_1,
    key: primary,
    rotation_key: rotation,
    requests,
    negative,
    registration_pop: {
      registration_token: registrationToken,
      public_key_b64: primary.public_key_b64,
      timestamp: BASE_TIMESTAMP_MS,
      message: registrationMessage,
      signature_b64: registrationSignature,
      request_body: {
        registration_token: registrationToken,
        public_key: primary.public_key_b64,
        plugin_version: PLUGIN_VERSION,
        game_version: '14.1.3',
        timestamp: BASE_TIMESTAMP_MS,
        pop_signature: registrationSignature,
      },
    },
    rotation_pop: {
      server_id: SERVER_ID,
      current_key_fingerprint: primary.fingerprint,
      new_public_key_b64: rotation.public_key_b64,
      new_key_fingerprint: rotation.fingerprint,
      timestamp: rotationTimestamp,
      message: rotationMessage,
      signature_b64: rotationPopSignature,
      request_body: JSON.parse(rotateBody) as Record<string, unknown>,
    },
    pop_negative: popNegative,
  };
}
