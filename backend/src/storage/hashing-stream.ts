/**
 * Transform that hashes (SHA-256) and counts bytes while passing them through, failing with
 * 413 PAYLOAD_TOO_LARGE as soon as the limit is exceeded.
 */
import { createHash, type Hash } from 'node:crypto';
import { Transform, type Readable, type TransformCallback } from 'node:stream';

import { AppError } from '../lib/errors';

export class HashingLimitStream extends Transform {
  private readonly hash: Hash = createHash('sha256');
  private bytes = 0;
  private digestHex: string | null = null;

  constructor(private readonly maxBytes: number) {
    super();
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new RangeError('maxBytes must be a non-negative integer');
  }

  override _transform(chunk: unknown, _encoding: BufferEncoding, callback: TransformCallback): void {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    this.bytes += buffer.length;
    if (this.bytes > this.maxBytes) {
      callback(new AppError('PAYLOAD_TOO_LARGE', `Object exceeds the maximum size of ${this.maxBytes} bytes`));
      return;
    }
    this.hash.update(buffer);
    callback(null, buffer);
  }

  override _flush(callback: TransformCallback): void {
    this.digestHex = this.hash.digest('hex');
    callback();
  }

  get size(): number {
    return this.bytes;
  }

  /** Hex digest; only available after the stream finished. */
  get sha256(): string {
    if (this.digestHex === null) throw new Error('HashingLimitStream has not finished');
    return this.digestHex;
  }
}

export interface CapturedSourceError {
  /** First error the source emitted (undefined while healthy). */
  readonly error: unknown;
  /** Detaches the listener (call once the upload is finished). */
  release(): void;
}

/**
 * Attaches an 'error' listener to an upload source before any asynchronous work, so a source
 * that fails early (client disconnect during pre-checks) neither crashes the process with an
 * unhandled 'error' event nor loses the reason.
 */
export function captureSourceError(source: Readable): CapturedSourceError {
  let captured: unknown;
  const onError = (err: unknown): void => {
    captured ??= err;
  };
  source.on('error', onError);
  return {
    get error(): unknown {
      return captured;
    },
    release(): void {
      source.off('error', onError);
    },
  };
}
