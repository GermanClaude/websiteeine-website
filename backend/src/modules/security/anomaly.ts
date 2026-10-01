/**
 * Heuristic anomaly flagging (NOT a guarantee, and never auto-punishing).
 *
 * A deterministic, dependency-free detector: per key (an actor or an endpoint) it keeps an
 * exponentially-weighted moving average (EWMA) of a metric and an EWMA of its variance, then
 * flags a new sample whose robust deviation (|value − mean| / stddev) exceeds `sensitivity`
 * once enough history exists. It is pure given its inputs (inject the clock and feed the
 * sample stream), so it is fully unit-testable and produces identical results every run.
 *
 * It only ever *flags* for human review; it does not block, throttle or punish.
 */
import type { SecuritySeverity } from '@scpsl-trust/shared';

export interface EwmaState {
  /** EWMA of the metric. */
  mean: number;
  /** EWMA of the squared deviation. */
  variance: number;
  /** Number of samples folded in. */
  count: number;
  /** Clock ms of the last update (for pruning stale baselines). */
  updatedAt: number;
}

export interface AnomalyFlag {
  key: string;
  value: number;
  mean: number;
  /** Robust deviation in standard deviations. */
  deviation: number;
  severity: SecuritySeverity;
  reason: string;
}

export interface AnomalyDetectorOptions {
  /** Deviation (in stddevs) at/above which a sample is flagged. */
  sensitivity: number;
  /** EWMA smoothing factor in (0,1]; higher reacts faster. Default 0.3. */
  alpha?: number;
  /** Minimum samples before any flag can fire (warm-up). Default 8. */
  minSamples?: number;
  /** Floor on stddev so a perfectly flat baseline still needs a real jump to flag. Default 1. */
  minStdDev?: number;
  /** Absolute floor on value before a flag can fire (ignore tiny-count noise). Default 5. */
  minValue?: number;
}

const DEFAULTS = { alpha: 0.3, minSamples: 8, minStdDev: 1, minValue: 5 } as const;

function severityForDeviation(deviation: number, sensitivity: number): SecuritySeverity {
  if (deviation >= sensitivity * 2.5) return 'high';
  if (deviation >= sensitivity * 1.5) return 'medium';
  return 'low';
}

export class AnomalyDetector {
  private readonly states = new Map<string, EwmaState>();
  private readonly alpha: number;
  private readonly minSamples: number;
  private readonly minStdDev: number;
  private readonly minValue: number;
  private readonly sensitivity: number;

  constructor(options: AnomalyDetectorOptions) {
    this.sensitivity = options.sensitivity;
    this.alpha = options.alpha ?? DEFAULTS.alpha;
    this.minSamples = options.minSamples ?? DEFAULTS.minSamples;
    this.minStdDev = options.minStdDev ?? DEFAULTS.minStdDev;
    this.minValue = options.minValue ?? DEFAULTS.minValue;
  }

  /**
   * Folds `value` into the baseline for `key` and returns a flag when it deviates strongly
   * from the baseline *as it was before this sample*. Deterministic given its arguments.
   */
  observe(key: string, value: number, now: Date): AnomalyFlag | null {
    const nowMs = now.getTime();
    const prior = this.states.get(key);
    let flag: AnomalyFlag | null = null;

    if (prior !== undefined && prior.count >= this.minSamples && value >= this.minValue) {
      const stdDev = Math.max(Math.sqrt(prior.variance), this.minStdDev);
      const deviation = Math.abs(value - prior.mean) / stdDev;
      // Only flag upward deviations (a spike), not a source going quiet.
      if (deviation >= this.sensitivity && value > prior.mean) {
        const severity = severityForDeviation(deviation, this.sensitivity);
        flag = {
          key,
          value,
          mean: Number(prior.mean.toFixed(3)),
          deviation: Number(deviation.toFixed(2)),
          severity,
          reason: `metric ${value} is ${deviation.toFixed(1)}x its own baseline mean of ${prior.mean.toFixed(1)}`,
        };
      }
    }

    // Update the baseline (EWMA of mean and of squared deviation).
    if (prior === undefined) {
      this.states.set(key, { mean: value, variance: 0, count: 1, updatedAt: nowMs });
    } else {
      const delta = value - prior.mean;
      const mean = prior.mean + this.alpha * delta;
      const variance = (1 - this.alpha) * (prior.variance + this.alpha * delta * delta);
      this.states.set(key, { mean, variance, count: prior.count + 1, updatedAt: nowMs });
    }
    return flag;
  }

  /** Current baseline for a key (for inspection/snapshots). */
  get(key: string): EwmaState | undefined {
    return this.states.get(key);
  }

  size(): number {
    return this.states.size;
  }

  /** Serializable snapshot of all baselines. */
  snapshot(): Record<string, EwmaState> {
    return Object.fromEntries(this.states);
  }

  /** Restores baselines from a snapshot (merging over current state). */
  load(snapshot: Record<string, EwmaState>): void {
    for (const [key, state] of Object.entries(snapshot)) {
      if (
        typeof state?.mean === 'number' &&
        typeof state.variance === 'number' &&
        typeof state.count === 'number' &&
        typeof state.updatedAt === 'number'
      ) {
        this.states.set(key, state);
      }
    }
  }

  /** Drops baselines untouched for longer than `maxAgeMs`; returns the number removed. */
  prune(now: Date, maxAgeMs: number): number {
    const cutoff = now.getTime() - maxAgeMs;
    let removed = 0;
    for (const [key, state] of this.states) {
      if (state.updatedAt < cutoff) {
        this.states.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}
