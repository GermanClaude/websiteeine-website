/**
 * Semantic severity chip for the security monitor. Severity is a *state* colour
 * (info → critical), never the brand accent. The mapping is exported so the tests can
 * prove every `SecuritySeverity` renders a tone + a label.
 */
import { SECURITY_SEVERITIES, type SecuritySeverity } from '@scpsl-trust/shared';

import { Badge, type BadgeTone } from '../../../components/Badge';
import { humanizeEnum } from '../../../components/StatusBadge';

/** Ascending severity → badge tone. high and critical share the alarming `danger` tone; critical adds a dot. */
export const SEVERITY_TONES: Readonly<Record<SecuritySeverity, BadgeTone>> = {
  info: 'muted',
  low: 'info',
  medium: 'warning',
  high: 'danger',
  critical: 'danger',
};

export function severityTone(severity: string): BadgeTone {
  return (SEVERITY_TONES as Record<string, BadgeTone>)[severity] ?? 'neutral';
}

export interface SeverityBadgeProps {
  severity: SecuritySeverity | string;
  /** Appends a count in parentheses (used in the summary strip). */
  count?: number;
}

export function SeverityBadge({ severity, count }: SeverityBadgeProps) {
  const emphasised = severity === 'critical' || severity === 'high';
  const label = humanizeEnum(severity);
  return (
    <Badge tone={severityTone(severity)} dot={emphasised} title={`Severity: ${severity}`}>
      {count === undefined ? label : `${label}: ${count}`}
    </Badge>
  );
}

/** Tuple used by tests to iterate every severity. */
export const ALL_SEVERITIES = SECURITY_SEVERITIES;
