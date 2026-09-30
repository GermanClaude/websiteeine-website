/**
 * Upload media handling (§11.3): MIME sniffing from magic bytes, the allow-list check,
 * UTF-8 validation for the text types without magic bytes, and filename sanitization.
 */
import { Readable, Transform, type TransformCallback } from 'node:stream';

import { fileTypeFromBuffer } from 'file-type';

import { EVIDENCE_ALLOWED_MIME_TYPES } from '@scpsl-trust/shared';

import { AppError } from '../../lib/errors';

const SNIFF_BYTES = 4100;
/** Declared types without magic bytes; accepted when the content is valid UTF-8 without NUL. */
const TEXT_TYPES: ReadonlySet<string> = new Set(['text/plain', 'application/json']);
const ALLOWED: ReadonlySet<string> = new Set(EVIDENCE_ALLOWED_MIME_TYPES);

export function normalizeDeclaredMime(contentType: string | undefined): string {
  return (contentType ?? '').split(';')[0]!.trim().toLowerCase();
}

export interface SniffedUpload {
  /** The MIME type to store (sniffed, or the declared text type). */
  mime: string;
  /** Full content stream (head + rest), UTF-8-validated for text types. */
  stream: Readable;
}

/**
 * Buffers the first bytes of `source`, sniffs the real type and checks it against the
 * declared type and the §11.3 allow-list. Mismatch or disallowed → 415.
 */
export async function sniffUpload(source: Readable, declaredMime: string): Promise<SniffedUpload> {
  const declared = declaredMime.toLowerCase();
  if (!ALLOWED.has(declared)) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', `Content type ${declared || '(none)'} is not allowed`);
  }

  // One shared iterator: breaking a for-await would destroy the source, so next() is
  // called manually for the head and the remainder continues from the same iterator.
  const iterator = source[Symbol.asyncIterator]();
  const head = await readHead(iterator, SNIFF_BYTES);
  const sniffed = head.length > 0 ? await fileTypeFromBuffer(head) : undefined;

  let stream = joinStream(head, iterator);
  if (TEXT_TYPES.has(declared)) {
    // text/plain and application/json have no magic bytes: reject content that sniffs as a
    // real binary type, then require valid UTF-8 without NUL bytes.
    if (sniffed !== undefined) {
      throw new AppError('UNSUPPORTED_MEDIA_TYPE', `Content does not match the declared type ${declared}`);
    }
    stream = stream.pipe(new Utf8ValidatingStream(declared));
    return { mime: declared, stream };
  }

  if (sniffed === undefined || !ALLOWED.has(sniffed.mime) || sniffed.mime !== declared) {
    throw new AppError('UNSUPPORTED_MEDIA_TYPE', `Content does not match the declared type ${declared}`);
  }
  return { mime: sniffed.mime, stream };
}

async function readHead(iterator: AsyncIterator<unknown>, maxBytes: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  while (size < maxBytes) {
    const { value, done } = await iterator.next();
    if (done === true) break;
    const buffer = Buffer.isBuffer(value) ? value : Buffer.from(value as string);
    chunks.push(buffer);
    size += buffer.length;
  }
  return Buffer.concat(chunks);
}

function joinStream(head: Buffer, rest: AsyncIterator<unknown>): Readable {
  async function* generate(): AsyncGenerator<Buffer> {
    if (head.length > 0) yield head;
    for (;;) {
      const { value, done } = await rest.next();
      if (done === true) return;
      yield Buffer.isBuffer(value) ? value : Buffer.from(value as string);
    }
  }
  return Readable.from(generate());
}

/** Passthrough that fails with 415 on invalid UTF-8 or NUL bytes. */
export class Utf8ValidatingStream extends Transform {
  private readonly decoder = new TextDecoder('utf-8', { fatal: true });

  constructor(private readonly declared: string) {
    super();
  }

  override _transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    if (buffer.includes(0)) {
      callback(new AppError('UNSUPPORTED_MEDIA_TYPE', `Content is not valid ${this.declared}`));
      return;
    }
    try {
      this.decoder.decode(buffer, { stream: true });
    } catch {
      callback(new AppError('UNSUPPORTED_MEDIA_TYPE', `Content is not valid ${this.declared}`));
      return;
    }
    callback(null, buffer);
  }

  override _flush(callback: TransformCallback): void {
    try {
      this.decoder.decode(new Uint8Array(0));
      callback();
    } catch {
      callback(new AppError('UNSUPPORTED_MEDIA_TYPE', `Content is not valid ${this.declared}`));
    }
  }
}

const FILENAME_MAX = 128;

/**
 * Strips directories, control characters and anything outside [A-Za-z0-9._ -], collapses
 * whitespace and bounds the length (extension kept). Never returns an empty string.
 */
export function sanitizeFilename(name: string | undefined): string | null {
  if (name === undefined) return null;
  const base = name.replace(/\\/g, '/').split('/').pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[^A-Za-z0-9._ -]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/^[. ]+/, '')
    .trim();
  if (cleaned === '' || cleaned === '.' || cleaned === '..') return null;
  if (cleaned.length <= FILENAME_MAX) return cleaned;
  const dot = cleaned.lastIndexOf('.');
  if (dot > 0 && cleaned.length - dot <= 16) {
    const ext = cleaned.slice(dot);
    return cleaned.slice(0, FILENAME_MAX - ext.length) + ext;
  }
  return cleaned.slice(0, FILENAME_MAX);
}
