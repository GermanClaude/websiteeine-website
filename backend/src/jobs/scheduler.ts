/**
 * Background job scheduler (ARCHITECTURE §1: jobs/scheduler.ts + one file per job, added by
 * the modules via registerJobs()).
 *
 * - Each job runs every `intervalMs` (measured from the end of the previous run).
 * - A distributed lock (ShortLivedStore / Redis) prevents concurrent runs of the same job
 *   across instances; a run skipped for the lock is not recorded.
 * - Every run that acquires the lock gets a job_runs row (running → succeeded | failed).
 * - Errors are isolated: a failing job is logged and retried at the next interval.
 */
import { randomUUID } from 'node:crypto';

import type { Kysely } from 'kysely';

import type { Database } from '../db/types';
import type { AppLogger } from '../lib/logger';
import type { Clock } from '../lib/time';
import { storeKeys } from '../redis/keys';
import type { ShortLivedStore } from '../redis/store';

/** Small counters / flags only (job_runs.details; no personal data). */
export type JobDetails = Record<string, string | number | boolean | null>;

export interface JobContext {
  readonly name: string;
  /** Aborted when the scheduler stops; long jobs should check it between batches. */
  readonly signal: AbortSignal;
  readonly logger: AppLogger;
  readonly startedAt: Date;
}

export type JobHandler = (context: JobContext) => Promise<JobDetails | void>;

export interface JobOptions {
  /** Run once right after start() instead of waiting one interval (default false). */
  runOnStart?: boolean;
  /** Lock TTL; must exceed the longest expected run (default max(2 × interval, 5 min)). */
  lockTtlMs?: number;
}

export interface JobRunOutcome {
  job: string;
  result: 'succeeded' | 'failed' | 'skipped';
  /** job_runs.id (absent when skipped). */
  runId?: string;
  details?: JobDetails;
  error?: string;
}

interface RegisteredJob {
  name: string;
  intervalMs: number;
  handler: JobHandler;
  runOnStart: boolean;
  lockTtlMs: number;
  timer: NodeJS.Timeout | null;
  running: Promise<JobRunOutcome> | null;
}

const JOB_NAME = /^[a-z][a-z0-9_-]{0,63}$/;
const MAX_ERROR_LENGTH = 500;

export interface JobSchedulerDeps {
  db: Kysely<Database>;
  store: ShortLivedStore;
  clock: Clock;
  logger: AppLogger;
}

export class JobScheduler {
  private readonly jobs = new Map<string, RegisteredJob>();
  private readonly instanceId = randomUUID();
  private abort = new AbortController();
  private started = false;

  constructor(private readonly deps: JobSchedulerDeps) {}

  register(name: string, intervalMs: number, handler: JobHandler, options: JobOptions = {}): void {
    if (!JOB_NAME.test(name)) throw new TypeError(`Invalid job name "${name}" (use [a-z][a-z0-9_-]{0,63})`);
    if (this.jobs.has(name)) throw new Error(`Job "${name}" is already registered`);
    if (!Number.isInteger(intervalMs) || intervalMs < 1_000) throw new RangeError('Job interval must be at least 1000 ms');
    const job: RegisteredJob = {
      name,
      intervalMs,
      handler,
      runOnStart: options.runOnStart ?? false,
      lockTtlMs: options.lockTtlMs ?? Math.max(2 * intervalMs, 300_000),
      timer: null,
      running: null,
    };
    this.jobs.set(name, job);
    if (this.started) this.schedule(job, job.runOnStart ? 0 : job.intervalMs);
  }

  /** Registered job names. */
  names(): string[] {
    return [...this.jobs.keys()];
  }

  get isRunning(): boolean {
    return this.started;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.abort = new AbortController();
    for (const job of this.jobs.values()) this.schedule(job, job.runOnStart ? 0 : job.intervalMs);
  }

  /** Stops scheduling, aborts running jobs and waits (up to timeoutMs) for them to finish. */
  async stop(timeoutMs = 10_000): Promise<void> {
    if (!this.started) return;
    this.started = false;
    this.abort.abort();
    const inFlight: Promise<unknown>[] = [];
    for (const job of this.jobs.values()) {
      if (job.timer !== null) clearTimeout(job.timer);
      job.timer = null;
      if (job.running !== null) inFlight.push(job.running);
    }
    if (inFlight.length === 0) return;
    let timeout: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled(inFlight),
      new Promise<void>((resolve) => {
        timeout = setTimeout(resolve, timeoutMs);
        timeout.unref();
      }),
    ]);
    if (timeout !== undefined) clearTimeout(timeout);
  }

  /** Runs a job immediately (still honouring the lock); used by tests and admin tools. */
  async runNow(name: string): Promise<JobRunOutcome> {
    const job = this.jobs.get(name);
    if (job === undefined) throw new Error(`Unknown job "${name}"`);
    if (job.running !== null) return { job: name, result: 'skipped' };
    return this.execute(job);
  }

  private schedule(job: RegisteredJob, delayMs: number): void {
    if (!this.started) return;
    job.timer = setTimeout(() => {
      job.timer = null;
      if (job.running !== null) {
        this.schedule(job, job.intervalMs);
        return;
      }
      void this.execute(job).finally(() => this.schedule(job, job.intervalMs));
    }, delayMs);
    job.timer.unref();
  }

  private execute(job: RegisteredJob): Promise<JobRunOutcome> {
    const run = this.runLocked(job).finally(() => {
      job.running = null;
    });
    job.running = run;
    return run;
  }

  private async runLocked(job: RegisteredJob): Promise<JobRunOutcome> {
    const { store, logger } = this.deps;
    const lockKey = storeKeys.lock(`job-${job.name}`);
    const token = `${this.instanceId}:${randomUUID()}`;
    let acquired: boolean;
    try {
      acquired = await store.setNx(lockKey, token, job.lockTtlMs);
    } catch (err) {
      logger.error({ err, job: job.name }, 'job lock unavailable');
      return { job: job.name, result: 'skipped', error: 'lock_unavailable' };
    }
    if (!acquired) {
      logger.debug({ job: job.name }, 'job skipped: running elsewhere');
      return { job: job.name, result: 'skipped' };
    }
    try {
      return await this.runRecorded(job);
    } finally {
      await store.delIfEquals(lockKey, token).catch((err: unknown) => {
        logger.warn({ err, job: job.name }, 'failed to release job lock');
      });
    }
  }

  private async runRecorded(job: RegisteredJob): Promise<JobRunOutcome> {
    const { db, clock, logger } = this.deps;
    const startedAt = clock.now();
    let runId: string | undefined;
    try {
      const row = await db
        .insertInto('job_runs')
        .values({ job: job.name, started_at: startedAt })
        .returning('id')
        .executeTakeFirstOrThrow();
      runId = row.id;
    } catch (err) {
      logger.error({ err, job: job.name }, 'failed to record job start');
    }

    const jobLogger = logger.child({ job: job.name, job_run_id: runId ?? null });
    let outcome: JobRunOutcome;
    try {
      const details = (await job.handler({ name: job.name, signal: this.abort.signal, logger: jobLogger, startedAt })) ?? {};
      outcome = { job: job.name, result: 'succeeded', details };
      jobLogger.info({ details }, 'job succeeded');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcome = { job: job.name, result: 'failed', error: message.slice(0, MAX_ERROR_LENGTH) };
      jobLogger.error({ err }, 'job failed');
    }
    if (runId !== undefined) outcome.runId = runId;

    if (runId !== undefined) {
      try {
        const details: JobDetails =
          outcome.result === 'succeeded' ? (outcome.details ?? {}) : { error: outcome.error ?? 'unknown error' };
        await db
          .updateTable('job_runs')
          .set({ finished_at: clock.now(), result: outcome.result, details })
          .where('id', '=', runId)
          .execute();
      } catch (err) {
        jobLogger.error({ err }, 'failed to record job result');
      }
    }
    return outcome;
  }
}
