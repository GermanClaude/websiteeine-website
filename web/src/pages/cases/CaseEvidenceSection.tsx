/**
 * Evidence list of a case: type, title, the three assessments + overall status, supersede
 * chain and the upload entry point.
 */
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';

import { Permission, type CaseStaffView, type EvidenceView } from '@scpsl-trust/shared';

import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { StatusBadge } from '../../components/StatusBadge';
import { EvidenceAssessmentBadges, EvidenceOverallBadge, supportsConfirmedVerdict } from '../evidence/EvidenceAssessments';
import { EvidenceUploadModal } from '../evidence/EvidenceUploadModal';

export function evidencePath(id: string): string {
  return `/evidence/${encodeURIComponent(id)}`;
}

function UploaderCell({ evidence }: { evidence: EvidenceView }) {
  if (evidence.uploader_user !== null) return <span>{evidence.uploader_user.username}</span>;
  if (evidence.uploader_server !== null) return <span>{evidence.uploader_server.name}</span>;
  return <span className="text-faint">—</span>;
}

function ChainCell({ evidence }: { evidence: EvidenceView }) {
  if (evidence.superseded_by_evidence_id === null && evidence.supersedes_evidence_id === null) return <span className="text-faint">—</span>;
  return (
    <span className="stack-sm text-xs" style={{ gap: 2 }}>
      {evidence.superseded_by_evidence_id !== null && (
        <span>
          <Badge tone="warning">superseded</Badge> by{' '}
          <Link to={evidencePath(evidence.superseded_by_evidence_id)} className="mono">
            {evidence.superseded_by_evidence_id.slice(0, 8)}
          </Link>
        </span>
      )}
      {evidence.supersedes_evidence_id !== null && (
        <span>
          replaces{' '}
          <Link to={evidencePath(evidence.supersedes_evidence_id)} className="mono">
            {evidence.supersedes_evidence_id.slice(0, 8)}
          </Link>
        </span>
      )}
    </span>
  );
}

const columns: readonly Column<EvidenceView>[] = [
  { key: 'type', header: 'Type', render: (row) => <StatusBadge kind="evidenceType" value={row.type} /> },
  {
    key: 'title',
    header: 'Title',
    render: (row) => (
      <span className="stack-sm" style={{ gap: 0 }}>
        <Link to={evidencePath(row.id)}>{row.title}</Link>
        {row.overwatch_session_id !== null && (
          <span className="text-xs text-muted">
            overwatch session{' '}
            <Link to={`/overwatch/${encodeURIComponent(row.overwatch_session_id)}`} className="mono">
              {row.overwatch_session_id.slice(0, 8)}
            </Link>
          </span>
        )}
      </span>
    ),
    wrap: true,
  },
  { key: 'assessments', header: 'Identity · Authentic · Cheating', render: (row) => <EvidenceAssessmentBadges assessment={row} compact /> },
  { key: 'status', header: 'Overall', render: (row) => <EvidenceOverallBadge status={row.status} />, sortValue: (row) => row.status },
  { key: 'chain', header: 'Replacement', render: (row) => <ChainCell evidence={row} /> },
  { key: 'uploaded', header: 'Uploaded', render: (row) => <DateTime value={row.uploaded_at} />, sortValue: (row) => row.uploaded_at },
  { key: 'uploader', header: 'By', render: (row) => <UploaderCell evidence={row} /> },
];

export function CaseEvidenceSection({ caseData }: { caseData: CaseStaffView }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const [uploadOpen, setUploadOpen] = useState(false);

  const isReporter = auth.user !== null && caseData.reports.some((report) => report.reporter_user?.id === auth.user?.id);
  // Backend rule (§11.3): reviewers, members of a server that reported on the case, the reporting user.
  const canUpload = auth.hasPermission(Permission.EVIDENCE_UPLOAD) || auth.hasServerMembership || isReporter;
  const supporting = caseData.evidence.filter(supportsConfirmedVerdict).length;
  const unreviewed = caseData.evidence.filter((item) => item.status === 'unverified' && item.superseded_by_evidence_id === null).length;

  return (
    <div className="stack-sm">
      <div className="row-between" style={{ padding: '0 var(--sp-4)' }}>
        <div className="row text-sm">
          <span className="text-muted">Awaiting review:</span>
          <Badge tone={unreviewed > 0 ? 'warning' : 'muted'}>{unreviewed}</Badge>
          <span className="text-muted">Supports a confirmed verdict:</span>
          <Badge tone={supporting > 0 ? 'success' : 'muted'} title="Authenticity and cheating both verified, not superseded">
            {supporting}
          </Badge>
        </div>
        {canUpload && (
          <Button size="sm" variant="primary" onClick={() => setUploadOpen(true)}>
            Add evidence
          </Button>
        )}
      </div>
      <p className="text-xs text-muted" style={{ padding: '0 var(--sp-4)' }}>
        Every item is assessed on three separate questions — identity, authenticity, cheating — plus an overall status. <strong>Unverified</strong> means
        "not yet reviewed", not "fake". A linked Overwatch session proves who recorded whom; it does not prove cheating. Evidence is immutable:
        replacing a file creates a new item and keeps the old one.
      </p>
      <DataTable
        columns={columns}
        rows={caseData.evidence}
        rowKey={(row) => row.id}
        onRowClick={(row) => void navigate(evidencePath(row.id))}
        rowClickLabel="Open evidence"
        rowClassName={(row) => (row.superseded_by_evidence_id !== null ? 'text-muted' : undefined)}
        emptyState={<EmptyState title="No evidence yet" description={canUpload ? 'Upload a recording, screenshot or log, or add an external link.' : undefined} />}
        caption="Evidence"
      />
      {canUpload && <EvidenceUploadModal open={uploadOpen} caseNumber={caseData.case_number} reports={caseData.reports} onClose={() => setUploadOpen(false)} />}
    </div>
  );
}
