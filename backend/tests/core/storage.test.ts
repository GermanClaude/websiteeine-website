import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { PassThrough, Readable } from 'node:stream';

import { HeadObjectCommand, GetObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config';
import { AppError } from '../../src/lib/errors';
import {
  createStorage,
  HashingLimitStream,
  isValidStorageKey,
  LocalObjectStorage,
  S3ObjectStorage,
  type S3Uploader,
} from '../../src/storage';
import { testEnv } from '../helpers';

const sha256 = (data: Buffer): string => createHash('sha256').update(data).digest('hex');

async function readAll(stream: Readable): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
  return Buffer.concat(chunks);
}

async function expectAppError(promise: Promise<unknown>, code: string): Promise<AppError> {
  try {
    await promise;
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe(code);
    return err as AppError;
  }
  throw new Error(`Expected AppError ${code}`);
}

/** Every file below `dir`, relative, sorted (temp files must never be left behind). */
async function listFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true, recursive: true })) {
    if (entry.isFile()) out.push(path.relative(dir, path.join(entry.parentPath, entry.name)));
  }
  return out.sort();
}

describe('storage keys', () => {
  it('accepts slash-separated segments and rejects traversal, hidden and malformed keys', () => {
    for (const key of ['evidence/2026/abc.bin', 'a', 'a/b/c-d_e.f', 'x'.repeat(128), `${'a/'.repeat(100)}b`]) {
      expect(isValidStorageKey(key), key).toBe(true);
    }
    for (const key of [
      '',
      '..',
      '../x',
      'a/../b',
      'a/./b',
      '/abs',
      'a//b',
      'a/',
      'a\\b',
      '.tmp-123',
      'a/.hidden',
      'a b',
      'ä',
      'a%2f..%2fb',
      'a\u0000b',
      'x'.repeat(129),
      'x'.repeat(513),
    ]) {
      expect(isValidStorageKey(key), JSON.stringify(key)).toBe(false);
    }
  });
});

describe('HashingLimitStream', () => {
  it('hashes and counts bytes and fails as soon as the limit is exceeded', async () => {
    const data = randomBytes(10_000);
    const hasher = new HashingLimitStream(10_000);
    const out = await readAll(Readable.from([data.subarray(0, 4000), data.subarray(4000)]).pipe(hasher));
    expect(out.equals(data)).toBe(true);
    expect(hasher.size).toBe(10_000);
    expect(hasher.sha256).toBe(sha256(data));

    const limited = new HashingLimitStream(9_999);
    await expectAppError(readAll(Readable.from([data]).pipe(limited)), 'PAYLOAD_TOO_LARGE');
    expect(() => new HashingLimitStream(-1)).toThrow(RangeError);
    expect(() => new HashingLimitStream(0).sha256).toThrow(/not finished/);
  });
});

describe('LocalObjectStorage', () => {
  let root: string;
  let storage: LocalObjectStorage;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'scpsl-trust-storage-test-'));
    storage = new LocalObjectStorage(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('stores, hashes, reads and describes objects', async () => {
    const data = randomBytes(70_000);
    const result = await storage.put('cases/2026/a.bin', Readable.from([data.subarray(0, 30_000), data.subarray(30_000)]), {
      contentType: 'application/octet-stream',
      maxBytes: 100_000,
    });
    expect(result).toEqual({ size: 70_000, sha256: sha256(data) });
    expect(await storage.exists('cases/2026/a.bin')).toBe(true);
    expect(await storage.head('cases/2026/a.bin')).toEqual({ size: 70_000, contentType: null });
    expect((await readAll(await storage.get('cases/2026/a.bin'))).equals(data)).toBe(true);
    expect(await listFiles(root)).toEqual(['cases/2026/a.bin']);
    const stat = await fs.stat(path.join(root, 'cases', '2026', 'a.bin'));
    expect(stat.mode & 0o777).toBe(0o600);
    await storage.ping();
  });

  it('never overwrites an existing object (write-once)', async () => {
    const original = Buffer.from('original');
    await storage.put('k/one', Readable.from([original]), { contentType: 'text/plain', maxBytes: 100 });
    await expectAppError(
      storage.put('k/one', Readable.from([Buffer.from('replacement')]), { contentType: 'text/plain', maxBytes: 100 }),
      'ALREADY_EXISTS',
    );
    expect((await readAll(await storage.get('k/one'))).equals(original)).toBe(true);
    expect(await listFiles(root)).toEqual(['k/one']);
  });

  it('rejects a concurrent second writer of the same key at publish time', async () => {
    // Both writers pass the up-front exists() check; only one may publish.
    const a = new PassThrough();
    const b = new PassThrough();
    const putA = storage.put('race/obj', a, { contentType: 'text/plain', maxBytes: 100 });
    const putB = storage.put('race/obj', b, { contentType: 'text/plain', maxBytes: 100 });
    await new Promise((resolve) => setTimeout(resolve, 50));
    a.end('A');
    b.end('B');
    const results = await Promise.allSettled([putA, putB]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toMatchObject({ code: 'ALREADY_EXISTS' });
    expect(await listFiles(root)).toEqual(['race/obj']);
  });

  it('enforces maxBytes and leaves no partial or temp file behind', async () => {
    const data = randomBytes(5_000);
    await expectAppError(
      storage.put('big/obj', Readable.from([data.subarray(0, 2_000), data.subarray(2_000)]), {
        contentType: 'application/octet-stream',
        maxBytes: 4_999,
      }),
      'PAYLOAD_TOO_LARGE',
    );
    expect(await storage.exists('big/obj')).toBe(false);
    expect(await listFiles(root)).toEqual([]);
    // Exactly the limit is fine.
    await storage.put('big/ok', Readable.from([data]), { contentType: 'application/octet-stream', maxBytes: 5_000 });
    expect(await listFiles(root)).toEqual(['big/ok']);
  });

  it('cleans up when the source stream fails', async () => {
    const source = new PassThrough();
    const put = storage.put('failing/obj', source, { contentType: 'text/plain', maxBytes: 1_000 });
    source.write('partial');
    source.destroy(new Error('client disconnected'));
    const error = await expectAppError(put, 'STORAGE_ERROR');
    expect((error.cause as Error).message).toBe('client disconnected');
    expect(await listFiles(root)).toEqual([]);

    // The same failure after the pipeline started streaming.
    const late = new PassThrough();
    const latePut = storage.put('failing/late', late, { contentType: 'text/plain', maxBytes: 1_000 });
    await new Promise((resolve) => setTimeout(resolve, 30));
    late.write('partial');
    late.destroy(new Error('client disconnected'));
    expect((await expectAppError(latePut, 'STORAGE_ERROR')).cause).toMatchObject({ message: 'client disconnected' });
    expect(await listFiles(root)).toEqual([]);
  });

  it('rejects traversal, absolute and hidden keys before touching the filesystem', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'scpsl-trust-outside-'));
    try {
      for (const key of ['../escape', `../${path.basename(outside)}/x`, '/etc/passwd', 'a/../../x', '.tmp-x', '..']) {
        await expect(storage.put(key, Readable.from([Buffer.from('x')]), { contentType: 'text/plain', maxBytes: 10 })).rejects.toThrow(
          TypeError,
        );
        await expect(storage.get(key)).rejects.toThrow(TypeError);
        await expect(storage.head(key)).rejects.toThrow(TypeError);
      }
      expect(await listFiles(root)).toEqual([]);
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('refuses to write through a symlink that leaves the root', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'scpsl-trust-outside-'));
    try {
      await storage.ping(); // creates the root
      await fs.symlink(outside, path.join(root, 'link'));
      await expectAppError(
        storage.put('link/escaped', Readable.from([Buffer.from('x')]), { contentType: 'text/plain', maxBytes: 10 }),
        'STORAGE_ERROR',
      );
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('reports missing objects', async () => {
    await expectAppError(storage.get('missing/obj'), 'NOT_FOUND');
    expect(await storage.head('missing/obj')).toBeNull();
    expect(await storage.exists('missing/obj')).toBe(false);
  });

  // Regression (docs/OPERATIONS.md, failure drill 4): an unusable storage root is "evidence
  // storage unavailable" and must surface as STORAGE_ERROR (502) like the S3 driver, not as an
  // opaque errno error that the HTTP layer turns into 500 INTERNAL_ERROR.
  it('reports an unusable storage root as STORAGE_ERROR, not a raw errno error', async () => {
    const blocker = path.join(root, 'not-a-directory');
    await fs.writeFile(blocker, 'regular file');
    const broken = new LocalObjectStorage(path.join(blocker, 'evidence'));

    const put = await expectAppError(
      broken.put('cases/2026/a.bin', Readable.from([Buffer.from('x')]), { contentType: 'application/octet-stream', maxBytes: 1_000 }),
      'STORAGE_ERROR',
    );
    expect(put.statusCode).toBe(502);
    await expectAppError(broken.get('cases/2026/a.bin'), 'STORAGE_ERROR');
    await expectAppError(broken.head('cases/2026/a.bin'), 'STORAGE_ERROR');
    await expectAppError(broken.ping(), 'STORAGE_ERROR');
  });

  it('is selected by createStorage for STORAGE_DRIVER=local', () => {
    const config = loadConfig(testEnv({ STORAGE_DRIVER: 'local', STORAGE_LOCAL_DIR: root }));
    expect(createStorage(config)).toBeInstanceOf(LocalObjectStorage);
    const s3 = loadConfig(testEnv({ STORAGE_DRIVER: 's3', STORAGE_BUCKET: 'evidence', STORAGE_ENDPOINT: 'http://localhost:9000' }));
    expect(createStorage(s3)).toBeInstanceOf(S3ObjectStorage);
  });
});

// ---------------------------------------------------------------------------
// S3 driver with a fake client and an injected uploader
// ---------------------------------------------------------------------------

interface FakeS3 {
  objects: Map<string, { body: Buffer; contentType: string }>;
  client: S3Client;
  uploader: S3Uploader;
  uploads: Array<{ key: string; aborted: boolean }>;
}

function s3Error(name: string, status: number): Error {
  const err = new Error(name);
  err.name = name;
  Object.assign(err, { $metadata: { httpStatusCode: status } });
  return err;
}

function createFakeS3(options: { rejectUploadWith?: Error } = {}): FakeS3 {
  const objects = new Map<string, { body: Buffer; contentType: string }>();
  const uploads: FakeS3['uploads'] = [];
  const client = {
    send: async (command: unknown) => {
      if (command instanceof HeadObjectCommand) {
        const object = objects.get(command.input.Key ?? '');
        if (object === undefined) throw s3Error('NotFound', 404);
        return { ContentLength: object.body.length, ContentType: object.contentType };
      }
      if (command instanceof GetObjectCommand) {
        const object = objects.get(command.input.Key ?? '');
        if (object === undefined) throw s3Error('NoSuchKey', 404);
        return { Body: Readable.from([object.body]) };
      }
      throw new Error(`unexpected command ${String((command as { constructor: { name: string } }).constructor.name)}`);
    },
  } as unknown as S3Client;
  const uploader: S3Uploader = async ({ key, body, contentType, abortSignal }) => {
    const record = { key, aborted: false };
    uploads.push(record);
    abortSignal.addEventListener('abort', () => {
      record.aborted = true;
    });
    const data = await readAll(body);
    if (options.rejectUploadWith !== undefined) throw options.rejectUploadWith;
    if (abortSignal.aborted) throw new Error('aborted');
    if (objects.has(key)) throw s3Error('PreconditionFailed', 412);
    objects.set(key, { body: data, contentType });
  };
  return { objects, client, uploader, uploads };
}

describe('S3ObjectStorage', () => {
  it('uploads with hashing, then reads and describes the object', async () => {
    const fake = createFakeS3();
    const storage = new S3ObjectStorage({ client: fake.client, bucket: 'evidence', uploader: fake.uploader });
    const data = randomBytes(20_000);
    const result = await storage.put('e/1', Readable.from([data]), { contentType: 'video/mp4', maxBytes: 50_000 });
    expect(result).toEqual({ size: 20_000, sha256: sha256(data) });
    expect(fake.objects.get('e/1')?.body.equals(data)).toBe(true);
    expect(await storage.head('e/1')).toEqual({ size: 20_000, contentType: 'video/mp4' });
    expect(await storage.exists('e/1')).toBe(true);
    expect((await readAll(await storage.get('e/1'))).equals(data)).toBe(true);
    await expectAppError(storage.get('e/missing'), 'NOT_FOUND');
    expect(await storage.head('e/missing')).toBeNull();
  });

  it('is write-once: existing keys are rejected up front and at commit time', async () => {
    const fake = createFakeS3();
    const storage = new S3ObjectStorage({ client: fake.client, bucket: 'evidence', uploader: fake.uploader });
    await storage.put('e/dup', Readable.from([Buffer.from('a')]), { contentType: 'text/plain', maxBytes: 10 });
    await expectAppError(
      storage.put('e/dup', Readable.from([Buffer.from('b')]), { contentType: 'text/plain', maxBytes: 10 }),
      'ALREADY_EXISTS',
    );
    expect(fake.uploads).toHaveLength(1);

    // Race: the object appears between the HEAD check and the conditional upload → 412 → ALREADY_EXISTS.
    const racy = createFakeS3({ rejectUploadWith: s3Error('PreconditionFailed', 412) });
    const racyStorage = new S3ObjectStorage({ client: racy.client, bucket: 'evidence', uploader: racy.uploader });
    await expectAppError(
      racyStorage.put('e/race', Readable.from([Buffer.from('c')]), { contentType: 'text/plain', maxBytes: 10 }),
      'ALREADY_EXISTS',
    );
  });

  it('aborts the upload and reports PAYLOAD_TOO_LARGE when the limit is exceeded', async () => {
    const fake = createFakeS3();
    const storage = new S3ObjectStorage({ client: fake.client, bucket: 'evidence', uploader: fake.uploader });
    const data = randomBytes(6_000);
    await expectAppError(
      storage.put('e/big', Readable.from([data.subarray(0, 3_000), data.subarray(3_000)]), {
        contentType: 'application/octet-stream',
        maxBytes: 5_000,
      }),
      'PAYLOAD_TOO_LARGE',
    );
    expect(fake.uploads[0]?.aborted).toBe(true);
    expect(fake.objects.has('e/big')).toBe(false);
  });

  it('survives a source that fails before the upload starts', async () => {
    const fake = createFakeS3();
    const storage = new S3ObjectStorage({ client: fake.client, bucket: 'evidence', uploader: fake.uploader });
    const source = new PassThrough();
    const put = storage.put('e/early', source, { contentType: 'text/plain', maxBytes: 10 });
    source.destroy(new Error('client disconnected'));
    const error = await expectAppError(put, 'STORAGE_ERROR');
    expect((error.cause as Error).message).toBe('client disconnected');
    expect(fake.objects.has('e/early')).toBe(false);
  });

  it('wraps provider failures as STORAGE_ERROR and validates keys', async () => {
    const failing = createFakeS3({ rejectUploadWith: new Error('connection reset') });
    const storage = new S3ObjectStorage({ client: failing.client, bucket: 'evidence', uploader: failing.uploader });
    const error = await expectAppError(
      storage.put('e/x', Readable.from([Buffer.from('a')]), { contentType: 'text/plain', maxBytes: 10 }),
      'STORAGE_ERROR',
    );
    expect((error.cause as Error).message).toBe('connection reset');
    await expect(storage.put('../x', Readable.from([Buffer.from('a')]), { contentType: 'text/plain', maxBytes: 10 })).rejects.toThrow(
      TypeError,
    );
    await expect(storage.get('/x')).rejects.toThrow(TypeError);
  });

  it('builds the client configuration from the storage config', () => {
    const config = loadConfig(
      testEnv({
        STORAGE_DRIVER: 's3',
        STORAGE_BUCKET: 'evidence',
        STORAGE_ENDPOINT: 'http://localhost:9000',
        STORAGE_REGION: 'eu-central-1',
        STORAGE_ACCESS_KEY: 'minio',
        STORAGE_SECRET_KEY: 'minio-secret',
        STORAGE_FORCE_PATH_STYLE: 'true',
      }),
    );
    expect(S3ObjectStorage.clientConfig(config.storage)).toEqual({
      region: 'eu-central-1',
      forcePathStyle: true,
      endpoint: 'http://localhost:9000',
      credentials: { accessKeyId: 'minio', secretAccessKey: 'minio-secret' },
    });
    const noKeys = loadConfig(testEnv({ STORAGE_DRIVER: 's3', STORAGE_BUCKET: 'evidence' }));
    expect(S3ObjectStorage.clientConfig(noKeys.storage)).toEqual({ region: 'us-east-1', forcePathStyle: false });
  });
});
