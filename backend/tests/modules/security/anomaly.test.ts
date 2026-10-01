/**
 * Deterministic anomaly detector (heuristic review flagging, never auto-punishing).
 * Pure: injected clock + explicit sample stream, identical results every run.
 */
import { describe, expect, it } from 'vitest';

import { AnomalyDetector } from '../../../src/modules/security/anomaly';

const AT = new Date('2026-10-01T00:00:00.000Z');

function feed(detector: AnomalyDetector, values: number[], now: Date = AT): ReturnType<AnomalyDetector['observe']>[] {
  return values.map((value) => detector.observe('user.reviewer-1', value, now));
}

describe('AnomalyDetector', () => {
  it('stays quiet on normal variance around a stable baseline', () => {
    const detector = new AnomalyDetector({ sensitivity: 3.5 });
    const normal = [10, 12, 9, 11, 10, 13, 8, 12, 11, 9, 10, 12];
    const flags = feed(detector, normal).filter((flag) => flag !== null);
    expect(flags).toEqual([]);
  });

  it('flags a planted upward spike after the baseline is warm', () => {
    const detector = new AnomalyDetector({ sensitivity: 3.5 });
    // Warm-up with a quiet, stable baseline (>= minSamples).
    feed(detector, [10, 11, 9, 10, 12, 10, 9, 11, 10, 10]);
    const spike = detector.observe('user.reviewer-1', 220, AT);
    expect(spike).not.toBeNull();
    expect(spike?.severity === 'high' || spike?.severity === 'medium').toBe(true);
    expect(spike?.value).toBe(220);
    expect(spike?.reason).toContain('baseline');
  });

  it('does not flag a source that merely goes quiet (downward deviation)', () => {
    const detector = new AnomalyDetector({ sensitivity: 3 });
    feed(detector, [40, 42, 38, 41, 39, 40, 43, 37, 40, 41]);
    const quiet = detector.observe('user.reviewer-1', 0, AT);
    expect(quiet).toBeNull();
  });

  it('respects the warm-up window (no flag before minSamples)', () => {
    const detector = new AnomalyDetector({ sensitivity: 2, minSamples: 8 });
    const early = [5, 5, 5, 200];
    const flags = feed(detector, early).filter((flag) => flag !== null);
    expect(flags).toEqual([]);
  });

  it('is deterministic: identical input streams give identical flags', () => {
    const stream = [10, 11, 9, 10, 12, 10, 9, 11, 10, 10, 150];
    const a = new AnomalyDetector({ sensitivity: 3 });
    const b = new AnomalyDetector({ sensitivity: 3 });
    expect(feed(a, stream)).toEqual(feed(b, stream));
  });

  it('snapshots, reloads and prunes stale baselines', () => {
    const detector = new AnomalyDetector({ sensitivity: 3 });
    feed(detector, [10, 11, 9, 10], AT);
    const snapshot = detector.snapshot();
    expect(Object.keys(snapshot)).toContain('user.reviewer-1');

    const restored = new AnomalyDetector({ sensitivity: 3 });
    restored.load(snapshot);
    expect(restored.get('user.reviewer-1')?.count).toBe(4);

    const later = new Date(AT.getTime() + 10 * 60_000);
    expect(restored.prune(later, 60_000)).toBe(1);
    expect(restored.size()).toBe(0);
  });
});
