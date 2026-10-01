/**
 * Background job for the security module: periodically evaluates the per-actor / per-endpoint
 * activity baselines, flags anomalies for human review, prunes stale baselines and writes a
 * baseline snapshot to the short-lived store.
 */
import type { Deps } from '../../container';
import type { JobScheduler } from '../../jobs/scheduler';

/** Interval of the baseline/anomaly evaluation job. */
export const SECURITY_BASELINE_INTERVAL_MS = 60_000;

export function registerSecurityJobs(scheduler: JobScheduler, deps: Deps): void {
  if (!deps.config.security.anomalyEnabled) return;
  scheduler.register('security-baseline', SECURITY_BASELINE_INTERVAL_MS, async () => {
    const result = await deps.security.runAnomalyBaseline();
    return { samples: result.samples, anomalies: result.anomalies, pruned: result.pruned };
  });
}
