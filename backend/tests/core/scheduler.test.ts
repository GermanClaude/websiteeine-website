import { describe, expect, it } from 'vitest';

import { JobScheduler, type JobContext } from '../../src/jobs/scheduler';
import { createSilentLogger } from '../../src/lib/logger';
import { createAdjustableClock } from '../../src/lib/time';
import { storeKeys } from '../../src/redis/keys';
import { MemoryShortLivedStore, type ShortLivedStore } from '../../src/redis/store';
import { useTestDatabase } from '../helpers';

function deferred<T = void>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe('JobScheduler', () => {
  const getDb = useTestDatabase();
  const clock = createAdjustableClock('2026-09-29T12:00:00.000Z');
  const logger = createSilentLogger();

  function createScheduler(store: ShortLivedStore = new MemoryShortLivedStore({ clock })): JobScheduler {
    return new JobScheduler({ db: getDb().db, store, clock, logger });
  }

  async function jobRuns(job: string) {
    return getDb()
      .db.selectFrom('job_runs')
      .selectAll()
      .where('job', '=', job)
      .orderBy('started_at', 'asc')
      .execute();
  }

  it('validates registrations', async () => {
    const scheduler = createScheduler();
    scheduler.register('retention', 60_000, async () => undefined);
    expect(() => scheduler.register('retention', 60_000, async () => undefined)).toThrow(/already registered/);
    expect(() => scheduler.register('Bad Name', 60_000, async () => undefined)).toThrow(TypeError);
    expect(() => scheduler.register('too-fast', 999, async () => undefined)).toThrow(RangeError);
    expect(() => scheduler.register('fraction', 1000.5, async () => undefined)).toThrow(RangeError);
    expect(scheduler.names()).toEqual(['retention']);
    expect(scheduler.isRunning).toBe(false);
    await expect(scheduler.runNow('unknown')).rejects.toThrow(/Unknown job/);
  });

  it('records a job_runs row per run with the returned counters', async () => {
    const scheduler = createScheduler();
    let context: JobContext | undefined;
    scheduler.register('counter-job', 60_000, async (ctx) => {
      context = ctx;
      return { deleted: 3, skipped: 0, note: 'ok', flag: true, none: null };
    });
    const outcome = await scheduler.runNow('counter-job');
    expect(outcome).toMatchObject({ job: 'counter-job', result: 'succeeded', details: { deleted: 3, note: 'ok' } });
    expect(context?.name).toBe('counter-job');
    expect(context?.signal.aborted).toBe(false);
    expect(context?.startedAt.toISOString()).toBe('2026-09-29T12:00:00.000Z');

    const runs = await jobRuns('counter-job');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      id: outcome.runId,
      result: 'succeeded',
      details: { deleted: 3, skipped: 0, note: 'ok', flag: true, none: null },
    });
    expect(runs[0]?.started_at.toISOString()).toBe('2026-09-29T12:00:00.000Z');
    expect(runs[0]?.finished_at).not.toBeNull();
  });

  it('isolates failures: the run is recorded as failed and other jobs keep working', async () => {
    const scheduler = createScheduler();
    scheduler.register('broken', 60_000, async () => {
      throw new Error(`boom ${'x'.repeat(1000)}`);
    });
    scheduler.register('healthy', 60_000, async () => ({ ok: 1 }));

    const failed = await scheduler.runNow('broken');
    expect(failed.result).toBe('failed');
    expect(failed.error).toHaveLength(500);
    expect(failed.details).toBeUndefined();
    const runs = await jobRuns('broken');
    expect(runs[0]).toMatchObject({ result: 'failed' });
    expect(String((runs[0]?.details as { error: string }).error)).toMatch(/^boom /);
    expect(runs[0]?.finished_at).not.toBeNull();

    expect((await scheduler.runNow('healthy')).result).toBe('succeeded');
    // The failed job can run again afterwards (lock released).
    expect((await scheduler.runNow('broken')).result).toBe('failed');
    expect(await jobRuns('broken')).toHaveLength(2);
  });

  it('never runs the same job concurrently across instances (shared lock)', async () => {
    const store = new MemoryShortLivedStore({ clock });
    const first = createScheduler(store);
    const second = createScheduler(store);
    const gate = deferred();
    let runs = 0;
    const handler = async (): Promise<void> => {
      runs += 1;
      await gate.promise;
    };
    first.register('shared', 60_000, handler);
    second.register('shared', 60_000, handler);

    const running = first.runNow('shared');
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(await store.get(storeKeys.lock('job-shared'))).toMatch(/^[0-9a-f-]{36}:[0-9a-f-]{36}$/);
    const skipped = await second.runNow('shared');
    expect(skipped).toEqual({ job: 'shared', result: 'skipped' });
    // A second runNow on the busy instance is skipped too.
    expect(await first.runNow('shared')).toEqual({ job: 'shared', result: 'skipped' });

    gate.resolve();
    expect((await running).result).toBe('succeeded');
    expect(runs).toBe(1);
    expect(await store.get(storeKeys.lock('job-shared'))).toBeNull();
    expect(await jobRuns('shared')).toHaveLength(1);

    // With the lock released the other instance may run.
    expect((await second.runNow('shared')).result).toBe('succeeded');
    expect(runs).toBe(2);
  });

  it('does not release a lock it does not own and skips when the lock is held elsewhere', async () => {
    const store = new MemoryShortLivedStore({ clock });
    const scheduler = createScheduler(store);
    scheduler.register('locked', 60_000, async () => ({ ran: 1 }));
    await store.set(storeKeys.lock('job-locked'), 'other-instance', 60_000);
    expect(await scheduler.runNow('locked')).toEqual({ job: 'locked', result: 'skipped' });
    expect(await jobRuns('locked')).toHaveLength(0);
    expect(await store.get(storeKeys.lock('job-locked'))).toBe('other-instance');
  });

  it('skips (without throwing) when the lock store is unavailable', async () => {
    const broken: ShortLivedStore = {
      ...new MemoryShortLivedStore({ clock }),
      kind: 'memory',
      setNx: async () => {
        throw new Error('redis down');
      },
    } as unknown as ShortLivedStore;
    const scheduler = createScheduler(broken);
    scheduler.register('no-lock', 60_000, async () => ({ ran: 1 }));
    expect(await scheduler.runNow('no-lock')).toEqual({ job: 'no-lock', result: 'skipped', error: 'lock_unavailable' });
    expect(await jobRuns('no-lock')).toHaveLength(0);
  });

  it('start() runs runOnStart jobs, reschedules them and stop() aborts running jobs', async () => {
    const scheduler = createScheduler();
    const started = deferred();
    let calls = 0;
    let observedAbort = false;
    scheduler.register(
      'startup',
      1_000,
      async (ctx) => {
        calls += 1;
        if (calls === 1) started.resolve();
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) return resolve();
          ctx.signal.addEventListener('abort', () => resolve(), { once: true });
          setTimeout(resolve, 5_000).unref();
        });
        observedAbort = ctx.signal.aborted;
      },
      { runOnStart: true },
    );
    scheduler.register('later', 60_000, async () => ({ ran: 1 }));

    scheduler.start();
    expect(scheduler.isRunning).toBe(true);
    scheduler.start(); // idempotent
    await started.promise;
    expect(calls).toBe(1);
    expect(await jobRuns('later')).toHaveLength(0);

    await scheduler.stop(2_000);
    expect(scheduler.isRunning).toBe(false);
    expect(observedAbort).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    expect(calls).toBe(1); // nothing rescheduled after stop()
    const runs = await jobRuns('startup');
    expect(runs).toHaveLength(1);
    expect(runs[0]?.result).toBe('succeeded');
    await scheduler.stop(); // idempotent
  });

  it('reschedules after each run while started', async () => {
    const scheduler = createScheduler();
    let calls = 0;
    scheduler.register('periodic', 1_000, async () => {
      calls += 1;
      return { calls };
    });
    scheduler.start();
    try {
      await new Promise((resolve) => setTimeout(resolve, 2_400));
      expect(calls).toBeGreaterThanOrEqual(2);
    } finally {
      await scheduler.stop();
    }
    expect((await jobRuns('periodic')).length).toBe(calls);
    // Jobs registered on a running scheduler are scheduled immediately when runOnStart is set.
    scheduler.start();
    const ran = deferred();
    scheduler.register('late-registration', 60_000, async () => ran.resolve(), { runOnStart: true });
    await ran.promise;
    await scheduler.stop();
  });
});
