/**
 * Filesystem object storage (STORAGE_DRIVER=local, STORAGE_LOCAL_DIR).
 *
 * Write-once and atomic: data is streamed into a unique temp file (flag 'wx', mode 0600)
 * in the target directory, then published with link(2), which fails instead of replacing
 * an existing object (rename would overwrite). Keys are validated and resolved strictly
 * inside the root directory (no traversal, no symlink escape).
 */
import { randomUUID } from 'node:crypto';
import { constants as fsConstants, createWriteStream } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { AppError, isAppError } from '../lib/errors';
import { captureSourceError, HashingLimitStream } from './hashing-stream';
import { assertStorageKey, type ObjectHead, type ObjectStorage, type PutObjectOptions, type PutObjectResult } from './types';

function errnoCode(err: unknown): string | undefined {
  return typeof err === 'object' && err !== null ? (Reflect.get(err, 'code') as string | undefined) : undefined;
}

function isWithin(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

export class LocalObjectStorage implements ObjectStorage {
  readonly driver = 'local' as const;
  private readonly root: string;
  private realRoot: Promise<string> | undefined;

  constructor(rootDir: string) {
    this.root = path.resolve(rootDir);
  }

  private async ensureRoot(): Promise<string> {
    this.realRoot ??= (async () => {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 });
      return fs.realpath(this.root);
    })().catch((err: unknown) => {
      this.realRoot = undefined;
      // The root is missing, not a directory, read-only or unreadable: that is the local
      // driver's "storage unavailable", so it must surface as 502 STORAGE_ERROR like the S3
      // driver does, not as an opaque 500 (docs/OPERATIONS.md).
      if (isAppError(err)) throw err;
      throw new AppError('STORAGE_ERROR', undefined, undefined, { cause: err });
    });
    return this.realRoot;
  }

  /** Absolute path of a key inside the (real) root; throws on invalid keys. */
  private async resolveKey(key: string): Promise<string> {
    assertStorageKey(key);
    const root = await this.ensureRoot();
    const target = path.resolve(root, ...key.split('/'));
    if (!isWithin(root, target)) throw new TypeError('Invalid storage key');
    return target;
  }

  private async assertRealParentWithinRoot(target: string): Promise<void> {
    const root = await this.ensureRoot();
    const parent = await fs.realpath(path.dirname(target));
    if (parent !== root && !isWithin(root, parent)) throw new AppError('STORAGE_ERROR', 'Storage path escapes the root');
  }

  async put(key: string, body: Readable, options: PutObjectOptions): Promise<PutObjectResult> {
    // A source that fails before pipeline() attaches its handlers (e.g. the client disconnects
    // during the checks below) must not raise an unhandled 'error' event.
    const source = captureSourceError(body);
    let temp: string | undefined;
    try {
      const target = await this.resolveKey(key);
      if (await this.exists(key)) throw new AppError('ALREADY_EXISTS', 'Object already exists');
      const dir = path.dirname(target);
      try {
        await fs.mkdir(dir, { recursive: true, mode: 0o700 });
        await this.assertRealParentWithinRoot(target);
      } catch (err) {
        if (isAppError(err)) throw err;
        throw new AppError('STORAGE_ERROR', undefined, undefined, { cause: err });
      }

      temp = path.join(dir, `.tmp-${randomUUID()}`);
      const hasher = new HashingLimitStream(options.maxBytes);
      try {
        await pipeline(body, hasher, createWriteStream(temp, { flags: 'wx', mode: 0o600 }));
        await this.publish(temp, target);
      } catch (err) {
        body.destroy();
        if (isAppError(err)) throw err;
        throw new AppError('STORAGE_ERROR', undefined, undefined, { cause: source.error ?? err });
      }
      return { size: hasher.size, sha256: hasher.sha256 };
    } finally {
      source.release();
      if (temp !== undefined) await fs.rm(temp, { force: true });
    }
  }

  /** link(2) never replaces; copyFile(EXCL) is the fallback for filesystems without hard links. */
  private async publish(temp: string, target: string): Promise<void> {
    try {
      await fs.link(temp, target);
    } catch (err) {
      const code = errnoCode(err);
      if (code === 'EEXIST') throw new AppError('ALREADY_EXISTS', 'Object already exists');
      if (code !== 'EPERM' && code !== 'ENOTSUP' && code !== 'EXDEV' && code !== 'ENOSYS') throw err;
      try {
        await fs.copyFile(temp, target, fsConstants.COPYFILE_EXCL);
      } catch (copyErr) {
        if (errnoCode(copyErr) === 'EEXIST') throw new AppError('ALREADY_EXISTS', 'Object already exists');
        throw copyErr;
      }
    }
  }

  async get(key: string): Promise<Readable> {
    const target = await this.resolveKey(key);
    try {
      const handle = await fs.open(target, 'r');
      return handle.createReadStream({ autoClose: true });
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') throw new AppError('NOT_FOUND', 'Object not found');
      throw new AppError('STORAGE_ERROR', undefined, undefined, { cause: err });
    }
  }

  async head(key: string): Promise<ObjectHead | null> {
    const target = await this.resolveKey(key);
    try {
      const stat = await fs.stat(target);
      return stat.isFile() ? { size: stat.size, contentType: null } : null;
    } catch (err) {
      if (errnoCode(err) === 'ENOENT') return null;
      throw new AppError('STORAGE_ERROR', undefined, undefined, { cause: err });
    }
  }

  async exists(key: string): Promise<boolean> {
    return (await this.head(key)) !== null;
  }

  async ping(): Promise<void> {
    const root = await this.ensureRoot();
    await fs.access(root, fsConstants.R_OK | fsConstants.W_OK);
  }
}
