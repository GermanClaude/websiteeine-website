/**
 * Signed plugin requests for tests (ARCHITECTURE §5.3). Builds the canonical string with
 * the shared builder, signs it with the test key and injects the request. Every part can be
 * overridden or tampered with for negative tests.
 */
import { randomBytes, randomUUID, type KeyObject } from 'node:crypto';

import type { FastifyInstance, LightMyRequestResponse } from 'fastify';

import { buildCanonicalRequest, SIGNING_HEADERS_LOWER } from '@scpsl-trust/shared';

import { sha256Hex, signEd25519, type Ed25519KeyPair } from '../../src/lib/crypto';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface SigningIdentity {
  server: { server_id: string };
  keyPair: Pick<Ed25519KeyPair, 'privateKey' | 'publicKeyB64'>;
  /** Sent as X-Key-Fingerprint unless `includeFingerprint: false`. */
  fingerprint?: string;
}

export interface SignedRequestOptions {
  method: HttpMethod;
  /** Path + query exactly as sent. */
  url: string;
  /** JSON body (serialized with JSON.stringify) … */
  body?: unknown;
  /** … or the exact body bytes. */
  rawBody?: string | Buffer;
  contentType?: string;
  /** Unix ms (default: the app clock). */
  timestamp?: number | string;
  nonce?: string;
  requestId?: string;
  pluginVersion?: string;
  includeFingerprint?: boolean;
  /** Headers applied after signing; `undefined` removes a header. */
  headers?: Record<string, string | undefined>;
  /** Tampering: sign these values instead of the ones sent. */
  sign?: {
    method?: string;
    url?: string;
    body?: string | Buffer;
    serverId?: string;
    timestamp?: number | string;
    nonce?: string;
    requestId?: string;
    /** Sign with another private key. */
    privateKey?: KeyObject;
    /** Replace the final signature. */
    signature?: string;
  };
}

export interface PreparedSignedRequest {
  method: HttpMethod;
  url: string;
  headers: Record<string, string>;
  payload: Buffer | undefined;
  canonical: string;
}

export function randomNonce(): string {
  return randomBytes(18).toString('base64url');
}

export function prepareSignedRequest(
  identity: SigningIdentity,
  options: SignedRequestOptions,
  nowMs: number,
): PreparedSignedRequest {
  const payload =
    options.rawBody !== undefined
      ? Buffer.from(options.rawBody)
      : options.body !== undefined
        ? Buffer.from(JSON.stringify(options.body), 'utf8')
        : undefined;
  const timestamp = options.timestamp ?? nowMs;
  const nonce = options.nonce ?? randomNonce();
  const requestId = options.requestId ?? randomUUID();
  const tamper = options.sign ?? {};
  const signedBody = tamper.body !== undefined ? Buffer.from(tamper.body) : (payload ?? Buffer.alloc(0));

  const canonical = buildCanonicalRequest({
    method: tamper.method ?? options.method,
    pathWithQuery: tamper.url ?? options.url,
    serverId: tamper.serverId ?? identity.server.server_id,
    timestamp: tamper.timestamp ?? timestamp,
    nonce: tamper.nonce ?? nonce,
    requestId: tamper.requestId ?? requestId,
    bodySha256Hex: sha256Hex(signedBody),
  });
  const signature = tamper.signature ?? signEd25519(tamper.privateKey ?? identity.keyPair.privateKey, canonical);

  const headers: Record<string, string> = {
    [SIGNING_HEADERS_LOWER.SERVER_ID]: identity.server.server_id,
    [SIGNING_HEADERS_LOWER.TIMESTAMP]: String(timestamp),
    [SIGNING_HEADERS_LOWER.NONCE]: nonce,
    [SIGNING_HEADERS_LOWER.REQUEST_ID]: requestId,
    [SIGNING_HEADERS_LOWER.PLUGIN_VERSION]: options.pluginVersion ?? '1.0.0',
    [SIGNING_HEADERS_LOWER.SIGNATURE]: signature,
  };
  if (options.includeFingerprint !== false && identity.fingerprint !== undefined) {
    headers[SIGNING_HEADERS_LOWER.KEY_FINGERPRINT] = identity.fingerprint;
  }
  if (payload !== undefined) headers['content-type'] = options.contentType ?? 'application/json';
  for (const [name, value] of Object.entries(options.headers ?? {})) {
    if (value === undefined) delete headers[name.toLowerCase()];
    else headers[name.toLowerCase()] = value;
  }
  return { method: options.method, url: options.url, headers, payload, canonical };
}

/** Signs and injects a plugin request; returns the response. */
export async function signedRequest(
  app: FastifyInstance,
  identity: SigningIdentity,
  options: SignedRequestOptions,
): Promise<LightMyRequestResponse> {
  const prepared = prepareSignedRequest(identity, options, app.deps.clock.now().getTime());
  return app.inject({
    method: prepared.method,
    url: prepared.url,
    headers: prepared.headers,
    ...(prepared.payload !== undefined ? { payload: prepared.payload } : {}),
  });
}
