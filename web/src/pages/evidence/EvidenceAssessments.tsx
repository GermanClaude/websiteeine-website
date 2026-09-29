/**
 * The three independent evidence assessments (R2) plus the overall status, as badges.
 * `unverified` means "not yet reviewed" — never "fake".
 */
import type { EvidenceAssessment, EvidenceStatus } from '@scpsl-trust/shared';

import { StatusBadge } from '../../components/StatusBadge';

export const ASSESSMENT_QUESTIONS = [
  { key: 'identity_status', short: 'Identity', question: 'Is the identity of the recorded player correct?' },
  { key: 'authenticity_status', short: 'Authentic', question: 'Is the evidence authentic (unedited, from the claimed source)?' },
  { key: 'cheating_status', short: 'Cheating', question: 'Does the evidence actually demonstrate cheating?' },
] as const satisfies ReadonlyArray<{ key: keyof EvidenceAssessment; short: string; question: string }>;

export type AssessmentKey = (typeof ASSESSMENT_QUESTIONS)[number]['key'];

export const EVIDENCE_STATUS_HELP: Readonly<Record<EvidenceStatus, string>> = {
  unverified: 'Not yet independently reviewed. This does not mean the evidence is fake.',
  verified: 'Independently reviewed and confirmed.',
  rejected: 'Reviewed and found not to hold.',
  inconclusive: 'Reviewed, but no determination was possible.',
};

export interface EvidenceAssessmentBadgesProps {
  assessment: EvidenceAssessment;
  /** Compact: three short badges only (tables). */
  compact?: boolean;
}

export function EvidenceAssessmentBadges({ assessment, compact = false }: EvidenceAssessmentBadgesProps) {
  return (
    <span className="row" style={{ gap: 4 }}>
      {ASSESSMENT_QUESTIONS.map((item) => (
        <StatusBadge
          key={item.key}
          kind="evidenceStatus"
          value={assessment[item.key]}
          label={compact ? `${item.short}: ${assessment[item.key]}` : `${item.short}: ${assessment[item.key]}`}
          title={`${item.question} — ${EVIDENCE_STATUS_HELP[assessment[item.key]]}`}
        />
      ))}
    </span>
  );
}

/** Overall status badge with the "unverified ≠ fake" tooltip. */
export function EvidenceOverallBadge({ status, dot = true }: { status: EvidenceStatus; dot?: boolean }) {
  return <StatusBadge kind="evidenceStatus" value={status} dot={dot} title={EVIDENCE_STATUS_HELP[status]} />;
}

/** True when this evidence item can support a `confirmed` verdict (§11.2): authentic + demonstrates cheating, not superseded. */
export function supportsConfirmedVerdict(evidence: EvidenceAssessment & { superseded_by_evidence_id: string | null }): boolean {
  return evidence.superseded_by_evidence_id === null && evidence.authenticity_status === 'verified' && evidence.cheating_status === 'verified';
}
