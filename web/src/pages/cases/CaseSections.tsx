/**
 * Read-only sections of the case page: reports, review history, appeals, audit history.
 */
import type { ReactNode } from 'react';
import { Link, useNavigate } from 'react-router';

import {
  AuditTargetType,
  isCaseNumber,
  type AppealView,
  type AuditEventSummary,
  type CaseReviewView,
  type CaseStaffView,
  type ReportView,
  type ReviewKind,
} from '@scpsl-trust/shared';

import { Badge, type BadgeTone } from '../../components/Badge';
import { LinkButton } from '../../components/Button';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime, RelativeTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { CaseLink, ServerLink, UserIdLink } from '../../components/Links';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { Timeline, type TimelineEntry } from '../../components/Timeline';

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

export function reportPath(id: string): string {
  return `/reports/${encodeURIComponent(id)}`;
}

export function ReporterCell({ report }: { report: ReportView }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <StatusBadge kind="reporterType" value={report.reporter_type} />
      {report.reporter_user !== null ? (
        <span>{report.reporter_user.username}</span>
      ) : report.reporter_player !== null ? (
        <UserIdLink userId={report.reporter_player.user_id} displayName={report.reporter_player.display_name} />
      ) : (
        <span className="text-faint">in-game (anonymous)</span>
      )}
    </span>
  );
}

const reportColumns: readonly Column<ReportView>[] = [
  { key: 'created', header: 'Submitted', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
  { key: 'reporter', header: 'Reporter', render: (row) => <ReporterCell report={row} /> },
  { key: 'server', header: 'Server', render: (row) => (row.server === null ? <span className="text-faint">—</span> : <ServerLink serverId={row.server.server_id} name={row.server.name} />) },
  { key: 'reason', header: 'Reason', render: (row) => row.reason, wrap: true },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="reportStatus" value={row.status} dot />, sortValue: (row) => row.status },
  { key: 'evidence', header: 'Evidence', align: 'right', render: (row) => row.evidence_count },
  { key: 'open', header: '', render: (row) => <Link to={reportPath(row.id)}>Details</Link> },
];

export function CaseReportsSection({ reports }: { reports: readonly ReportView[] }) {
  const navigate = useNavigate();
  return (
    <div className="stack-sm">
      <p className="text-sm text-muted" style={{ padding: '0 var(--sp-4)' }}>
        Reports are claims made by users or forwarded by game servers. They never change the verdict: three reports do not equal guilt.
      </p>
      <DataTable
        columns={reportColumns}
        rows={reports}
        rowKey={(row) => row.id}
        onRowClick={(row) => void navigate(reportPath(row.id))}
        rowClickLabel="Open report"
        emptyState={<EmptyState title="No reports" description="This case was opened without a report." />}
        caption="Reports on this case"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review history
// ---------------------------------------------------------------------------

const REVIEW_KIND_TONE: Readonly<Record<ReviewKind, BadgeTone>> = {
  review_started: 'info',
  verdict_set: 'danger',
  note: 'neutral',
  appeal_decision: 'accent',
  reopened: 'warning',
};

function reviewTitle(review: CaseReviewView): ReactNode {
  const kind = <StatusBadge kind="reviewKind" value={review.kind} />;
  if (review.kind === 'verdict_set' || review.kind === 'appeal_decision') {
    return (
      <span className="row" style={{ gap: 6 }}>
        {kind}
        {review.previous_verdict !== null && (
          <>
            <StatusBadge kind="verdict" value={review.previous_verdict} /> <span aria-hidden="true">→</span>
          </>
        )}
        {review.new_verdict !== null && <StatusBadge kind="verdict" value={review.new_verdict} dot />}
        {review.previous_verdict !== null && review.new_verdict !== null && review.previous_verdict === review.new_verdict && (
          <span className="text-xs text-muted">(unchanged)</span>
        )}
      </span>
    );
  }
  return kind;
}

export function CaseReviewHistory({ reviews }: { reviews: readonly CaseReviewView[] }) {
  const entries: TimelineEntry[] = [...reviews]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((review) => ({
      id: review.id,
      at: review.created_at,
      title: reviewTitle(review),
      description: <span style={{ whiteSpace: 'pre-wrap' }}>{review.comment}</span>,
      meta: (
        <>
          {review.reviewer.pseudonym}
          {review.appeal_id !== null && (
            <>
              {' · '}
              <Link to={`/appeals/${encodeURIComponent(review.appeal_id)}`}>appeal</Link>
            </>
          )}
        </>
      ),
      tone: REVIEW_KIND_TONE[review.kind],
    }));
  return (
    <div className="stack-sm">
      <p className="text-sm text-muted">Reviewers appear by pseudonym only. Entries are immutable: nothing here can be edited or deleted.</p>
      <Timeline entries={entries} emptyTitle="No review activity yet" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------

const appealColumns: readonly Column<AppealView>[] = [
  { key: 'created', header: 'Submitted', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
  { key: 'by', header: 'Submitted by', render: (row) => row.submitted_by.username },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="appealStatus" value={row.status} dot /> },
  { key: 'assigned', header: 'Assigned', render: (row) => row.assigned_reviewer?.pseudonym ?? <span className="text-faint">—</span> },
  {
    key: 'decision',
    header: 'Decision',
    render: (row) =>
      row.decision === null ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="row" style={{ gap: 6 }}>
          <StatusBadge kind="appealDecision" value={row.decision} />
          {row.decided_by !== null && <span className="text-xs text-muted">by {row.decided_by.pseudonym}</span>}
          {row.conflict_override && <Badge tone="warning" title="Decided despite a conflict of interest (super admin override, audited)">override</Badge>}
        </span>
      ),
  },
  { key: 'open', header: '', render: (row) => <Link to={`/appeals/${encodeURIComponent(row.id)}`}>Details</Link> },
];

export interface CaseAppealsSectionProps {
  caseData: CaseStaffView;
  /** The signed-in user is the linked owner of the case's player identity. */
  isCasePlayer: boolean;
}

export function CaseAppealsSection({ caseData, isCasePlayer }: CaseAppealsSectionProps) {
  const navigate = useNavigate();
  const hasOpenAppeal = caseData.appeals.some((appeal) => appeal.status === 'open' || appeal.status === 'under_review');
  const appealable = caseData.verdict === 'confirmed' || caseData.verdict === 'inconclusive';
  const canAppeal = isCasePlayer && appealable && !hasOpenAppeal;
  return (
    <div className="stack-sm">
      <div className="row-between" style={{ padding: '0 var(--sp-4)' }}>
        <p className="text-sm text-muted" style={{ margin: 0 }}>
          Appeals are decided by a reviewer who did not set the verdict and did not report the case. A decision of "reverse" sets the verdict to rejected.
        </p>
        {isCasePlayer && (
          <LinkButton to={`/appeals/new?case=${encodeURIComponent(caseData.case_number)}`} variant="primary" size="sm" aria-disabled={!canAppeal} onClick={(event) => {
            if (!canAppeal) event.preventDefault();
          }}>
            Appeal this case
          </LinkButton>
        )}
      </div>
      {isCasePlayer && !canAppeal && (
        <p className="text-xs text-muted" style={{ padding: '0 var(--sp-4)' }}>
          {hasOpenAppeal ? 'An appeal is already open for this case.' : 'Only cases with a confirmed or inconclusive verdict can be appealed.'}
        </p>
      )}
      <DataTable
        columns={appealColumns}
        rows={caseData.appeals}
        rowKey={(row) => row.id}
        onRowClick={(row) => void navigate(`/appeals/${encodeURIComponent(row.id)}`)}
        rowClickLabel="Open appeal"
        emptyState={<EmptyState title="No appeals" />}
        caption="Appeals"
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Audit history
// ---------------------------------------------------------------------------

function auditTarget(event: AuditEventSummary): ReactNode {
  if (event.target_id === null) return humanizeEnum(event.target_type);
  if (event.target_type === AuditTargetType.CASE && isCaseNumber(event.target_id)) return <CaseLink caseNumber={event.target_id} />;
  if (event.target_type === AuditTargetType.EVIDENCE) {
    return (
      <>
        evidence <Link to={`/evidence/${encodeURIComponent(event.target_id)}`} className="mono text-xs">{event.target_id}</Link>
      </>
    );
  }
  if (event.target_type === AuditTargetType.REPORT) {
    return (
      <>
        report <Link to={reportPath(event.target_id)} className="mono text-xs">{event.target_id}</Link>
      </>
    );
  }
  return (
    <>
      {humanizeEnum(event.target_type)} <span className="mono text-xs">{event.target_id}</span>
    </>
  );
}

export function CaseHistoryTimeline({ history }: { history: readonly AuditEventSummary[] }) {
  const entries: TimelineEntry[] = [...history]
    .sort((a, b) => b.seq - a.seq)
    .map((event) => ({
      id: event.event_id,
      at: event.created_at,
      title: <StatusBadge kind="auditAction" value={event.action} />,
      description: <span className="text-sm">{auditTarget(event)}</span>,
      meta: (
        <>
          <StatusBadge kind="actorType" value={event.actor_type} />
          {event.actor_label !== null && <> {event.actor_label}</>}
          {' · '}
          <RelativeTime value={event.created_at} />
        </>
      ),
    }));
  return (
    <div className="stack-sm">
      <p className="text-sm text-muted">Append-only, hash-chained audit events related to this case. Actors are shown by username, server id or reviewer pseudonym.</p>
      <Timeline entries={entries} emptyTitle="No audit events" />
    </div>
  );
}
