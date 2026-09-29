/**
 * Presentation helpers shared by the appeal pages.
 */
import type { AppealDecision, AppealView } from '@scpsl-trust/shared';

export const DECISION_LABELS: Readonly<Record<AppealDecision, string>> = Object.freeze({
  confirm: 'Confirm verdict',
  reverse: 'Reverse verdict',
  inconclusive: 'Inconclusive',
});

export const DECISION_EFFECTS: Readonly<Record<AppealDecision, string>> = Object.freeze({
  confirm: 'The case verdict stays as it is.',
  reverse: 'The case verdict becomes "rejected".',
  inconclusive: 'The case verdict becomes "inconclusive".',
});

export function isAppealOpen(appeal: Pick<AppealView, 'status'>): boolean {
  return appeal.status === 'open' || appeal.status === 'under_review';
}

/** Route of the appeal detail page. */
export function appealPath(id: string): string {
  return `/appeals/${encodeURIComponent(id)}`;
}
