/**
 * `uploadEvidence` uses XMLHttpRequest for progress; this fakes the XHR to assert the multipart
 * fields, the CSRF header, progress callbacks and the parsed response (SHA-256 from the backend).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApiError, resetClientState, setCsrfToken, type UploadProgress } from '../src/api/client';
import { uploadEvidence } from '../src/api/evidence';
import { CASE_NUMBER, SHA256, fakeEvidence } from './moderation-fixtures';

type ProgressHandler = ((event: ProgressEvent) => void) | null;

class FakeXhr {
  static instances: FakeXhr[] = [];
  method = '';
  url = '';
  withCredentials = false;
  responseType = '';
  status = 0;
  response: string = '';
  headers: Record<string, string> = {};
  responseHeaders: Record<string, string> = {};
  sent: FormData | null = null;
  upload: { onprogress: ProgressHandler } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;

  constructor() {
    FakeXhr.instances.push(this);
  }
  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
  }
  getResponseHeader(name: string): string | null {
    return this.responseHeaders[name.toLowerCase()] ?? null;
  }
  send(body: FormData) {
    this.sent = body;
  }
  abort() {
    this.onabort?.();
  }
  progress(loaded: number, total: number) {
    this.upload.onprogress?.({ lengthComputable: true, loaded, total } as ProgressEvent);
  }
  respond(status: number, body: unknown, headers: Record<string, string> = {}) {
    this.status = status;
    this.response = body === undefined ? '' : JSON.stringify(body);
    this.responseHeaders = headers;
    this.onload?.();
  }
}

describe('uploadEvidence', () => {
  const OriginalXhr = globalThis.XMLHttpRequest;

  beforeEach(() => {
    resetClientState();
    setCsrfToken('csrf-upload');
    FakeXhr.instances = [];
    globalThis.XMLHttpRequest = FakeXhr as unknown as typeof XMLHttpRequest;
  });

  afterEach(() => {
    globalThis.XMLHttpRequest = OriginalXhr;
  });

  it('posts the multipart form with the CSRF header, reports progress and returns the stored evidence', async () => {
    const file = new File(['abc'], 'clip.mp4', { type: 'video/mp4' });
    const progress: UploadProgress[] = [];
    const promise = uploadEvidence(
      CASE_NUMBER,
      { file, fields: { type: 'video', title: 'Round 3', description: null, report_id: null, overwatch_session_id: null } },
      (p) => progress.push(p),
    );

    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    const xhr = FakeXhr.instances[0];
    if (xhr === undefined) throw new Error('no xhr');
    expect(xhr.method).toBe('POST');
    expect(xhr.url).toBe(`/api/v1/cases/${CASE_NUMBER}/evidence`);
    expect(xhr.withCredentials).toBe(true);
    expect(xhr.headers['x-csrf-token']).toBe('csrf-upload');
    expect(xhr.sent).toBeInstanceOf(FormData);
    expect(xhr.sent?.get('type')).toBe('video');
    expect(xhr.sent?.get('title')).toBe('Round 3');
    expect(xhr.sent?.has('description')).toBe(false);
    expect(xhr.sent?.get('file')).toBeInstanceOf(File);
    // The file is appended last so the backend parses the text fields first.
    expect([...(xhr.sent?.keys() ?? [])].at(-1)).toBe('file');

    xhr.progress(50, 100);
    xhr.progress(100, 100);
    xhr.respond(201, fakeEvidence(), { 'x-request-id': 'req-upload' });

    const result = await promise;
    expect(result.sha256).toBe(SHA256);
    expect(result.status).toBe('unverified');
    expect(progress.map((p) => p.fraction)).toEqual([0.5, 1]);
    expect(progress[0]).toEqual({ loaded: 50, total: 100, fraction: 0.5 });
  });

  it('maps an error envelope to ApiError', async () => {
    const file = new File(['abc'], 'clip.exe', { type: 'application/octet-stream' });
    const promise = uploadEvidence(CASE_NUMBER, { file, fields: { type: 'other', title: 'Bad', description: null, report_id: null, overwatch_session_id: null } });
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    FakeXhr.instances[0]?.respond(415, { error: { code: 'UNSUPPORTED_MEDIA_TYPE', message: 'File type not allowed', request_id: 'req-415' } });

    await expect(promise).rejects.toMatchObject({ status: 415, code: 'UNSUPPORTED_MEDIA_TYPE', requestId: 'req-415' });
    await promise.catch((error: unknown) => expect(ApiError.is(error)).toBe(true));
  });

  it('rejects with an AbortError when cancelled', async () => {
    const controller = new AbortController();
    const file = new File(['abc'], 'clip.mp4', { type: 'video/mp4' });
    const promise = uploadEvidence(CASE_NUMBER, { file, fields: { type: 'video', title: 'X', description: null, report_id: null, overwatch_session_id: null } }, undefined, controller.signal);
    await vi.waitFor(() => expect(FakeXhr.instances).toHaveLength(1));
    controller.abort();
    await expect(promise).rejects.toMatchObject({ name: 'AbortError' });
  });
});
