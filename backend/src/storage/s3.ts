/**
 * S3-compatible object storage (STORAGE_DRIVER=s3: AWS S3, MinIO, Ceph, R2, …).
 *
 * Write-once: an existing key is rejected up front (HeadObject) and the upload itself is
 * conditional (`If-None-Match: *`, honoured by S3 and recent MinIO; multipart uploads
 * carry it on CompleteMultipartUpload). Bytes are hashed and size-limited while streaming;
 * exceeding the limit aborts the upload (no partial object is committed).
 */
import {
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  S3Client,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import type { Config } from '../config';
import { AppError, isAppError } from '../lib/errors';
import { HashingLimitStream } from './hashing-stream';
import { assertStorageKey, type ObjectHead, type ObjectStorage, type PutObjectOptions, type PutObjectResult } from './types';

/** Upload runner (injectable for tests); resolves when the object is committed. */
export type S3Uploader = (input: {
  client: S3Client;
  bucket: string;
  key: string;
  body: Readable;
  contentType: string;
  abortSignal: AbortSignal;
}) => Promise<void>;

const PART_SIZE = 8 * 1024 * 1024;

export const defaultS3Uploader: S3Uploader = async ({ client, bucket, key, body, contentType, abortSignal }) => {
  const abortController = new AbortController();
  const upload = new Upload({
    client,
    params: { Bucket: bucket, Key: key, Body: body, ContentType: contentType, IfNoneMatch: '*' },
    queueSize: 2,
    partSize: PART_SIZE,
    leavePartsOnError: false,
    abortController,
  });
  const onAbort = (): void => {
    void upload.abort().catch(() => undefined);
  };
  abortSignal.addEventListener('abort', onAbort, { once: true });
  try {
    await upload.done();
  } finally {
    abortSignal.removeEventListener('abort', onAbort);
  }
};

function httpStatusOf(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null) return undefined;
  const metadata = Reflect.get(err, '$metadata') as { httpStatusCode?: number } | undefined;
  return metadata?.httpStatusCode;
}

function errorName(err: unknown): string | undefined {
  return err instanceof Error ? err.name : undefined;
}

function isNotFound(err: unknown): boolean {
  const name = errorName(err);
  return name === 'NotFound' || name === 'NoSuchKey' || httpStatusOf(err) === 404;
}

function isPreconditionFailed(err: unknown): boolean {
  const name = errorName(err);
  return name === 'PreconditionFailed' || httpStatusOf(err) === 412;
}

export interface S3ObjectStorageOptions {
  client: S3Client;
  bucket: string;
  uploader?: S3Uploader;
}

export class S3ObjectStorage implements ObjectStorage {
  readonly driver = 's3' as const;
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly uploader: S3Uploader;

  constructor(options: S3ObjectStorageOptions) {
    this.client = options.client;
    this.bucket = options.bucket;
    this.uploader = options.uploader ?? defaultS3Uploader;
  }

  static clientConfig(storage: Config['storage']): S3ClientConfig {
    const clientConfig: S3ClientConfig = {
      region: storage.region,
      forcePathStyle: storage.forcePathStyle,
    };
    if (storage.endpoint !== null) clientConfig.endpoint = storage.endpoint;
    if (storage.accessKey !== null && storage.secretKey !== null) {
      clientConfig.credentials = { accessKeyId: storage.accessKey, secretAccessKey: storage.secretKey };
    }
    return clientConfig;
  }

  static fromConfig(storage: Config['storage']): S3ObjectStorage {
    if (storage.bucket === null) throw new Error('STORAGE_BUCKET is required for the s3 driver');
    return new S3ObjectStorage({ client: new S3Client(S3ObjectStorage.clientConfig(storage)), bucket: storage.bucket });
  }

  async put(key: string, body: Readable, options: PutObjectOptions): Promise<PutObjectResult> {
    assertStorageKey(key);
    if (await this.exists(key)) throw new AppError('ALREADY_EXISTS', 'Object already exists');

    const hasher = new HashingLimitStream(options.maxBytes);
    const abort = new AbortController();
    const feeding = pipeline(body, hasher).catch((err: unknown) => {
      abort.abort();
      throw err;
    });
    try {
      await Promise.all([
        feeding,
        this.uploader({
          client: this.client,
          bucket: this.bucket,
          key,
          body: hasher,
          contentType: options.contentType,
          abortSignal: abort.signal,
        }),
      ]);
    } catch (err) {
      abort.abort();
      body.destroy();
      hasher.destroy();
      // Prefer the stream error (e.g. PAYLOAD_TOO_LARGE) over the resulting upload abort.
      const streamError = await feeding.then(
        () => undefined,
        (feedErr: unknown) => feedErr,
      );
      const cause = streamError ?? err;
      if (isAppError(cause)) throw cause;
      if (isPreconditionFailed(cause)) throw new AppError('ALREADY_EXISTS', 'Object already exists');
      throw new AppError('STORAGE_ERROR', undefined, undefined, { cause });
    }
    return { size: hasher.size, sha256: hasher.sha256 };
  }

  async get(key: string): Promise<Readable> {
    assertStorageKey(key);
    try {
      const result = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: key }));
      const body = result.Body;
      if (body instanceof Readable) return body;
      if (body !== undefined && typeof (body as { transformToWebStream?: unknown }).transformToWebStream === 'function') {
        const web = (body as { transformToWebStream: () => ReadableStream<Uint8Array> }).transformToWebStream();
        return Readable.fromWeb(web as import('node:stream/web').ReadableStream<Uint8Array>);
      }
      throw new AppError('STORAGE_ERROR', 'Unexpected object body');
    } catch (err) {
      if (isAppError(err)) throw err;
      if (isNotFound(err)) throw new AppError('NOT_FOUND', 'Object not found');
      throw new AppError('STORAGE_ERROR', undefined, undefined, { cause: err });
    }
  }

  async head(key: string): Promise<ObjectHead | null> {
    assertStorageKey(key);
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return { size: Number(result.ContentLength ?? 0), contentType: result.ContentType ?? null };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw new AppError('STORAGE_ERROR', undefined, undefined, { cause: err });
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async ping(): Promise<void> {
    await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
  }
}
