/**
 * Builds shared/test-vectors/proof-codes.json (ARCHITECTURE §10.2).
 */
import { buildProofMessage, PROOF_ALPHABET, PROOF_MESSAGE_VERSION, proofCodeFromMac, proofWindow } from '../../src/signing';
import { fixtureBytes, hmacSha256 } from './node-crypto';
import type { ProofCodeVector, ProofCodeVectors } from './types';

const SESSION_A = '5b1d7e2a-8c4f-4a6b-9e3d-1f2a3b4c5d6e';
const SESSION_B = 'e2c4a6b8-1d3f-4e5a-8b7c-9d0e1f2a3b4c';
const SERVER_A = 'srv_7k4x92m8pq174kf9';
const SERVER_B = 'srv_m8pq174kf97k4x92';
const TARGET_STEAM = '76561198000000001@steam';
const SPECTATOR_STEAM = '76561198000000002@steam';
const TARGET_DISCORD = '123456789012345678@discord';
const SPECTATOR_NORTHWOOD = 'staff.member_01@northwood';

interface ProofSpec {
  name: string;
  secret: Buffer;
  session_id: string;
  server_id: string;
  target_user_id: string;
  spectator_user_id: string;
  unix_seconds: number;
  interval_seconds: number;
}

/** Independent bit extraction (string of bits) to cross-check proofCodeFromMac. */
function manualCode(mac: Buffer): string {
  const bits = Array.from(mac.subarray(0, 4), (byte) => byte.toString(2).padStart(8, '0')).join('').slice(0, 30);
  let code = '';
  for (let i = 0; i < 6; i += 1) code += PROOF_ALPHABET.charAt(parseInt(bits.slice(i * 5, i * 5 + 5), 2));
  return `${code.slice(0, 3)}-${code.slice(3)}`;
}

export function buildProofVectors(): ProofCodeVectors {
  const secretA = fixtureBytes('overwatch-secret-a', 32);
  const secretB = fixtureBytes('overwatch-secret-b', 32);
  const zeros = Buffer.alloc(32, 0x00);
  const ones = Buffer.alloc(32, 0xff);
  const base = {
    secret: secretA,
    session_id: SESSION_A,
    server_id: SERVER_A,
    target_user_id: TARGET_STEAM,
    spectator_user_id: SPECTATOR_STEAM,
  };

  const specs: ProofSpec[] = [
    { ...base, name: 'interval10_window_start_exact_multiple', unix_seconds: 1_790_000_000, interval_seconds: 10 },
    { ...base, name: 'interval10_window_last_second', unix_seconds: 1_790_000_009, interval_seconds: 10 },
    { ...base, name: 'interval10_next_window_boundary', unix_seconds: 1_790_000_010, interval_seconds: 10 },
    { ...base, name: 'interval10_previous_window', unix_seconds: 1_789_999_999, interval_seconds: 10 },
    { ...base, name: 'interval30_window_start_exact_multiple', unix_seconds: 1_790_000_010, interval_seconds: 30 },
    { ...base, name: 'interval30_window_last_second', unix_seconds: 1_790_000_039, interval_seconds: 30 },
    { ...base, name: 'interval30_next_window_boundary', unix_seconds: 1_790_000_040, interval_seconds: 30 },
    { ...base, name: 'interval5_minimum_interval', unix_seconds: 1_790_000_003, interval_seconds: 5 },
    { ...base, name: 'interval60_maximum_interval', unix_seconds: 1_790_000_059, interval_seconds: 60 },
    { ...base, name: 'secret_all_zero', secret: zeros, unix_seconds: 1_790_000_000, interval_seconds: 10 },
    { ...base, name: 'secret_all_ff', secret: ones, unix_seconds: 1_790_000_000, interval_seconds: 10 },
    { ...base, name: 'other_secret_same_inputs', secret: secretB, unix_seconds: 1_790_000_000, interval_seconds: 10 },
    { ...base, name: 'other_session_same_inputs', session_id: SESSION_B, unix_seconds: 1_790_000_000, interval_seconds: 10 },
    { ...base, name: 'other_server_same_inputs', server_id: SERVER_B, unix_seconds: 1_790_000_000, interval_seconds: 10 },
    {
      ...base,
      name: 'discord_target_northwood_spectator',
      target_user_id: TARGET_DISCORD,
      spectator_user_id: SPECTATOR_NORTHWOOD,
      unix_seconds: 1_790_000_000,
      interval_seconds: 10,
    },
    {
      ...base,
      name: 'swapped_target_and_spectator',
      target_user_id: SPECTATOR_STEAM,
      spectator_user_id: TARGET_STEAM,
      unix_seconds: 1_790_000_000,
      interval_seconds: 10,
    },
    { ...base, name: 'epoch_zero_window_zero', unix_seconds: 0, interval_seconds: 10 },
    { ...base, name: 'year_2100', unix_seconds: 4_102_444_800, interval_seconds: 10 },
  ];

  const cases: ProofCodeVector[] = specs.map((spec) => {
    const window = proofWindow(spec.unix_seconds, spec.interval_seconds);
    if (window !== Math.floor(spec.unix_seconds / spec.interval_seconds)) throw new Error(`window mismatch ${spec.name}`);
    const message = buildProofMessage({
      sessionId: spec.session_id,
      serverId: spec.server_id,
      targetUserId: spec.target_user_id,
      spectatorUserId: spec.spectator_user_id,
      window,
    });
    const expectedMessage = `${PROOF_MESSAGE_VERSION}|${spec.session_id}|${spec.server_id}|${spec.target_user_id}|${spec.spectator_user_id}|${window}`;
    if (message !== expectedMessage) throw new Error(`message mismatch ${spec.name}`);
    const mac = hmacSha256(spec.secret, message);
    const code = proofCodeFromMac(mac);
    if (code !== manualCode(mac)) throw new Error(`code mismatch ${spec.name}`);
    return {
      name: spec.name,
      secret_b64: spec.secret.toString('base64'),
      secret_hex: spec.secret.toString('hex'),
      session_id: spec.session_id,
      server_id: spec.server_id,
      target_user_id: spec.target_user_id,
      spectator_user_id: spec.spectator_user_id,
      unix_seconds: spec.unix_seconds,
      interval_seconds: spec.interval_seconds,
      window,
      message,
      mac_hex: mac.toString('hex'),
      code,
    };
  });

  return {
    version: PROOF_MESSAGE_VERSION,
    description:
      'Overwatch proof codes (ARCHITECTURE §10.2): w = floor(unix_seconds / interval_seconds); mac = HMAC-SHA256(secret, message); v = uint32_be(mac[0..3]) >>> 2; 6 x 5 bits MSB-first over the alphabet; code = XXX-XXX.',
    alphabet: PROOF_ALPHABET,
    cases,
  };
}
