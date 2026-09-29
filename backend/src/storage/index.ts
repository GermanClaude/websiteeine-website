/**
 * Storage factory: STORAGE_DRIVER=local | s3.
 */
import type { Config } from '../config';
import { LocalObjectStorage } from './local';
import { S3ObjectStorage } from './s3';
import type { ObjectStorage } from './types';

export function createStorage(config: Config): ObjectStorage {
  return config.storage.driver === 's3'
    ? S3ObjectStorage.fromConfig(config.storage)
    : new LocalObjectStorage(config.storage.localDir);
}

export { HashingLimitStream } from './hashing-stream';
export { LocalObjectStorage } from './local';
export { defaultS3Uploader, S3ObjectStorage, type S3Uploader } from './s3';
export * from './types';
