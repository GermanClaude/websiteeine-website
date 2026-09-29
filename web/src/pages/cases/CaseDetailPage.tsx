/**
 * Case page (brief §21): header, summary, actions by permission and tabbed sections.
 * Falls back to the public view when the staff view is not permitted (403).
 */
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';

import { Permission, isCaseNumber } from '@scpsl-trust/shared';

import { ApiError } from '../../api/client';
import { caseKeys, getCase } from '../../api/cases';
import { getPublicCase, publicKeys } from '../../api/public';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateTime, RelativeTime } from '../../components/DateTime';
import { ErrorState } from '../../components/ErrorState';
import { KeyValueList } from '../../components/KeyValueList';
import { UserIdLink } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';
import { TabPanel, Tabs } from '../../components/Tabs';
import { PublicCaseView, VERDICT_EXPLANATIONS } from '../public/PublicCaseView';
import { CaseCommentModal, CaseVerdictModal, type CaseCommentAction } from './CaseActionModals';
import { CaseConfirmationsSection } from './CaseConfirmationsSection';
import { CaseEvidenceSection } from './CaseEvidenceSection';
import { CaseAppealsSection, CaseHistoryTimeline, CaseReportsSection, CaseReviewHistory } from './CaseSections';

const TAB_IDS = ['reports', 'evidence', 'reviews', 'appeals', 'confirmations', 'history'] as const;
type TabId = (typeof TAB_IDS)[number];

function isTabId(value: string | null): value is TabId {
  return value !== null && (TAB_IDS as readonly string[]).includes(value);
}

/** Public-view fallback for users who can see the case but not its staff details. */
function PublicCaseFallback({ caseNumber }: { caseNumber: string }) {
  const publicCase = useQuery({ queryKey: publicKeys.detail(caseNumber), queryFn: () => getPublicCase(caseNumber) });
  if (publicCase.isPending) return <LoadingState />;
  if (publicCase.isError) return <ErrorState error={publicCase.error} onRetry={() => void publicCase.refetch()} />;
  return (
    <div className="stack">
      <div className="alert alert-info" role="status">
        You can see the <strong>public view</strong> of this case only. Staff details (reports, evidence, review history) are visible to reviewers and to
        the teams of servers involved in the case.
      </div>
      <PublicCaseView data={publicCase.data} playerLink={<UserIdLink userId={publicCase.data.player.user_id} displayName={publicCase.data.player.display_name} />} />
    </div>
  );
}

export function CaseDetailPage() {
  const params = useParams<{ caseNumber: string }>();
  const caseNumber = decodeURIComponent(params.caseNumber ?? '').toUpperCase();
  const auth = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [commentAction, setCommentAction] = useState<CaseCommentAction | null>(null);
  const [verdictOpen, setVerdictOpen] = useState(false);

  const valid = isCaseNumber(caseNumber);
  const caseQuery = useQuery({ queryKey: caseKeys.detail(caseNumber), queryFn: () => getCase(caseNumber), enabled: valid });

  const tabParam = searchParams.get('tab');
  const tab: TabId = isTabId(tabParam) ? tabParam : 'reports';
  const setTab = (next: TabId) =>
    setSearchParams(
      (current) => {
        const params = new URLSearchParams(current);
        if (next === 'reports') params.delete('tab');
        else params.set('tab', next);
        return params;
      },
      { replace: true },
    );

  if (!valid) {
    return (
      <>
        <PageHeader title="Case" breadcrumbs={[{ label: 'Cases', to: '/cases' }, { label: 'Invalid' }]} />
        <ErrorState error={new ApiError({ status: 404, code: 'NOT_FOUND', message: `"${caseNumber}" is not a valid case number (expected CASE-YYYY-NNNNNN).` })} />
      </>
    );
  }

  const breadcrumbs = [{ label: 'Cases', to: '/cases' }, { label: caseNumber }];

  if (caseQuery.isPending) {
    return (
      <>
        <PageHeader title={caseNumber} breadcrumbs={breadcrumbs} />
        <LoadingState />
      </>
    );
  }

  if (caseQuery.isError) {
    if (ApiError.is(caseQuery.error) && caseQuery.error.isForbidden) {
      return (
        <>
          <PageHeader title={caseNumber} breadcrumbs={breadcrumbs} />
          <PublicCaseFallback caseNumber={caseNumber} />
        </>
      );
    }
    return (
      <>
        <PageHeader title={caseNumber} breadcrumbs={breadcrumbs} />
        <ErrorState error={caseQuery.error} onRetry={() => void caseQuery.refetch()}>
          <p className="text-sm">
            <Link to={`/public/cases/${encodeURIComponent(caseNumber)}`}>Try the public view</Link>
          </p>
        </ErrorState>
      </>
    );
  }

  const data = caseQuery.data;
  const canReview = auth.hasPermission(Permission.CASE_REVIEW);
  const canSetVerdict = auth.hasPermission(Permission.CASE_SET_VERDICT);
  const canReopen = auth.hasPermission(Permission.CASE_REOPEN);
  const isCasePlayer = auth.me?.linked_player?.user_id === data.player.user_id;
  const activeConfirmations = data.confirmations.filter((item) => item.active).length;
  const unreviewedEvidence = data.evidence.filter((item) => item.status === 'unverified' && item.superseded_by_evidence_id === null).length;

  const tabs = [
    { id: 'reports' as const, label: 'Reports', count: data.reports.length },
    { id: 'evidence' as const, label: 'Evidence', count: data.evidence.length },
    { id: 'reviews' as const, label: 'Review history', count: data.reviews.length },
    { id: 'appeals' as const, label: 'Appeals', count: data.appeals.length },
    { id: 'confirmations' as const, label: 'Server confirmations', count: activeConfirmations },
    { id: 'history' as const, label: 'Audit history', count: data.history.length },
  ];

  return (
    <>
      <PageHeader
        title={data.case_number}
        documentTitle={data.case_number}
        breadcrumbs={breadcrumbs}
        badges={
          <span className="row" style={{ marginLeft: 8, display: 'inline-flex' }}>
            <StatusBadge kind="verdict" value={data.verdict} dot />
            <StatusBadge kind="caseStatus" value={data.status} />
          </span>
        }
        subtitle={
          <span className="row">
            <UserIdLink userId={data.player.user_id} displayName={data.player.display_name} showType />
            <span className="text-muted">
              · opened <RelativeTime value={data.created_at} /> · updated <RelativeTime value={data.updated_at} />
            </span>
          </span>
        }
        actions={
          <>
            {canReview && data.status === 'open' && (
              <Button variant="primary" onClick={() => setCommentAction('start')}>
                Start review
              </Button>
            )}
            {canReview && (
              <Button onClick={() => setCommentAction('note')}>Add note</Button>
            )}
            {canSetVerdict && data.status !== 'closed' && (
              <Button variant={data.verdict === 'unknown' ? 'primary' : 'secondary'} onClick={() => setVerdictOpen(true)}>
                Set verdict
              </Button>
            )}
            {canSetVerdict && data.status === 'closed' && !canReopen && (
              <Button disabled title="Closed cases must be reopened before a new verdict can be set">
                Set verdict
              </Button>
            )}
            {canReopen && data.status === 'closed' && <Button onClick={() => setCommentAction('reopen')}>Reopen</Button>}
          </>
        }
      />

      <div className="stack">
        <div className="grid-2">
          <Card title="Summary">
            <KeyValueList
              items={[
                {
                  label: 'Verdict',
                  value: (
                    <span className="stack-sm" style={{ gap: 2 }}>
                      <span className="row">
                        <StatusBadge kind="verdict" value={data.verdict} dot />
                        {data.verdict_set_by !== null && (
                          <span className="text-xs text-muted">
                            by {data.verdict_set_by.pseudonym} <DateTime value={data.verdict_set_at} />
                          </span>
                        )}
                      </span>
                      <span className="text-xs text-muted">{VERDICT_EXPLANATIONS[data.verdict]}</span>
                    </span>
                  ),
                },
                { label: 'Status', value: <StatusBadge kind="caseStatus" value={data.status} /> },
                { label: 'Reason (internal)', value: <span style={{ whiteSpace: 'pre-wrap' }}>{data.reason}</span> },
                { label: 'Public summary', value: data.public_summary === null ? <span className="text-faint">none — nothing beyond the verdict is shown publicly</span> : <span style={{ whiteSpace: 'pre-wrap' }}>{data.public_summary}</span> },
                { label: 'Opened', value: <DateTime value={data.created_at} /> },
                { label: 'Closed', value: <DateTime value={data.closed_at} empty="open" /> },
              ]}
            />
          </Card>
          <Card title="At a glance">
            <KeyValueList
              items={[
                {
                  label: 'Reports',
                  value: (
                    <span>
                      {data.reports.length}{' '}
                      <span className="text-xs text-muted">({data.reports.filter((report) => report.status === 'open' || report.status === 'under_review').length} open)</span>
                    </span>
                  ),
                },
                {
                  label: 'Evidence',
                  value: (
                    <span className="row" style={{ gap: 6 }}>
                      {data.evidence.length}
                      {unreviewedEvidence > 0 && <Badge tone="warning">{unreviewedEvidence} unverified (not yet reviewed)</Badge>}
                    </span>
                  ),
                },
                {
                  label: 'Server confirmations',
                  value: (
                    <span>
                      {data.confirmed_servers} <span className="text-xs text-muted">({data.independent_confirmed_servers} independent owners)</span>
                    </span>
                  ),
                },
                {
                  label: 'Appeals',
                  value: data.appeals.length === 0 ? <span className="text-faint">none</span> : <StatusBadge kind="appealStatus" value={data.appeals[data.appeals.length - 1]?.status ?? 'open'} />,
                },
                { label: 'Internal id', value: <span className="mono text-xs">{data.id}</span> },
              ]}
            />
            <hr className="divider" />
            <p className="text-xs text-muted" style={{ margin: 0 }}>
              Identity, evidence authenticity and the cheating verdict are separate. Reports, evidence counts and confirmations inform reviewers; only a
              reviewer's decision changes the verdict.
            </p>
          </Card>
        </div>

        <Card flush>
          <div style={{ padding: '0 var(--sp-4)' }}>
            <Tabs tabs={tabs} value={tab} onChange={setTab} label="Case sections" idPrefix="case" />
          </div>
          <div style={{ paddingTop: 'var(--sp-3)' }}>
            {tab === 'reports' && (
              <TabPanel id="reports" idPrefix="case">
                <CaseReportsSection reports={data.reports} />
              </TabPanel>
            )}
            {tab === 'evidence' && (
              <TabPanel id="evidence" idPrefix="case">
                <CaseEvidenceSection caseData={data} />
              </TabPanel>
            )}
            {tab === 'reviews' && (
              <TabPanel id="reviews" idPrefix="case">
                <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
                  <CaseReviewHistory reviews={data.reviews} />
                </div>
              </TabPanel>
            )}
            {tab === 'appeals' && (
              <TabPanel id="appeals" idPrefix="case">
                <CaseAppealsSection caseData={data} isCasePlayer={isCasePlayer} />
              </TabPanel>
            )}
            {tab === 'confirmations' && (
              <TabPanel id="confirmations" idPrefix="case">
                <CaseConfirmationsSection caseData={data} />
              </TabPanel>
            )}
            {tab === 'history' && (
              <TabPanel id="history" idPrefix="case">
                <div style={{ padding: '0 var(--sp-4) var(--sp-4)' }}>
                  <CaseHistoryTimeline history={data.history} />
                </div>
              </TabPanel>
            )}
          </div>
        </Card>
      </div>

      {canReview && <CaseCommentModal caseNumber={data.case_number} action={commentAction} onClose={() => setCommentAction(null)} />}
      {canReopen && !canReview && <CaseCommentModal caseNumber={data.case_number} action={commentAction} onClose={() => setCommentAction(null)} />}
      {canSetVerdict && <CaseVerdictModal open={verdictOpen} caseData={data} onClose={() => setVerdictOpen(false)} />}
    </>
  );
}

export default CaseDetailPage;
