/**
 * Object storage abstraction for evidence files (ARCHITECTURE §1.1, §11.3). Objects are
 * write-once: put() never overwrites an existing key (evidence is immutable, R7).
 */
import type { Readable } from 'node:stream';

export interface PutObjectOptions {
  contentType: string;
  /** Hard size limit; exceeding it aborts the upload with 413 PAYLOAD_TOO_LARGE. */
  maxBytes: number;
}

export interface PutObjectResult {
  size: number;
  /** Lowercase hex SHA-256 of the stored bytes (computed while streaming). */
  sha256: string;
}

export interface ObjectHead {
  size: number;
  contentType: string | null;
}

export interface ObjectStorage {
  readonly driver: 'local' | 's3';
  /** Streams `body` to `key`. Rejects with 409 ALREADY_EXISTS when the key exists. */
  put(key: string, body: Readable, options: PutObjectOptions): Promise<PutObjectResult>;
  /** Readable of the object; 404 NOT_FOUND when missing. */
  get(key: string): Promise<Readable>;
  /** Metadata or null when missing. */
  head(key: string): Promise<ObjectHead | null>;
  exists(key: string): Promise<boolean>;
  /** Throws when the backend is unreachable (readiness). */
  ping(): Promise<void>;
}

/** Keys: `/`-separated segments of [A-Za-z0-9._-], no `.`/`..` segments, ≤ 512 chars. */
const SEGMENT = /^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/;

export function isValidStorageKey(key: string): boolean {
  if (typeof key !== 'string' || key.length === 0 || key.length > 512) return false;
  return key.split('/').every((segment) => SEGMENT.test(segment) && segment !== '.' && segment !== '..');
}

export function assertStorageKey(key: string): void {
  if (!isValidStorageKey(key)) throw new TypeError('Invalid storage key');
}
