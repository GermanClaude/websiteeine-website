/**
 * Limited public presentation of a case (`GET /public/cases/{caseNumber}`): no reports,
 * no evidence details, no reviewer identities, no internal reason.
 */
import type { ReactNode } from 'react';

import type { CasePublicView } from '@scpsl-trust/shared';

import { Card } from '../../components/Card';
import { DateTime } from '../../components/DateTime';
import { KeyValueList } from '../../components/KeyValueList';
import { StatusBadge } from '../../components/StatusBadge';

export const VERDICT_EXPLANATIONS: Readonly<Record<CasePublicView['verdict'], string>> = {
  unknown: 'No verdict has been set. Reports alone are not a verdict.',
  inconclusive: 'Reviewed, but the evidence did not allow a determination either way.',
  confirmed: 'A reviewer confirmed cheating based on verified, authentic evidence.',
  rejected: 'Reviewed and rejected: the reports were not substantiated.',
};

export function PublicCaseView({ data, playerLink }: { data: CasePublicView; playerLink?: ReactNode }) {
  return (
    <div className="stack">
      <Card title="Case">
        <KeyValueList
          items={[
            { label: 'Case number', value: <span className="mono">{data.case_number}</span> },
            {
              label: 'Player',
              value: playerLink ?? (
                <span>
                  {data.player.display_name !== null && data.player.display_name !== '' ? <>{data.player.display_name} </> : null}
                  <span className="mono text-muted">{data.player.user_id}</span>
                </span>
              ),
            },
            {
              label: 'Verdict',
              value: (
                <span className="row">
                  <StatusBadge kind="verdict" value={data.verdict} dot />
                  <span className="text-sm text-muted">{VERDICT_EXPLANATIONS[data.verdict]}</span>
                </span>
              ),
            },
            { label: 'Status', value: <StatusBadge kind="caseStatus" value={data.status} /> },
            { label: 'Verdict set', value: <DateTime value={data.verdict_set_at} empty="not set" /> },
            { label: 'Public summary', value: data.public_summary },
            { label: 'Appeal', value: data.appeal_status === null ? <span className="text-faint">none</span> : <StatusBadge kind="appealStatus" value={data.appeal_status} /> },
            { label: 'Opened', value: <DateTime value={data.created_at} /> },
            { label: 'Last update', value: <DateTime value={data.updated_at} /> },
          ]}
        />
      </Card>
      <div className="grid-3">
        <Card title="Reports">
          <div className="stat-value">{data.report_count}</div>
          <p className="text-xs text-muted">Reports are claims, not findings. Three reports do not equal guilt.</p>
        </Card>
        <Card title="Evidence">
          <div className="stat-value">
            {data.verified_evidence_count} <span className="text-muted text-sm">verified of {data.evidence_count}</span>
          </div>
          <p className="text-xs text-muted">Unverified evidence has not been reviewed yet; that does not mean it is fake.</p>
        </Card>
        <Card title="Server confirmations">
          <div className="stat-value">{data.confirmed_servers}</div>
          <p className="text-xs text-muted">Servers that independently confirmed the finding. Confirmations never change the verdict automatically.</p>
        </Card>
      </div>
    </div>
  );
}
