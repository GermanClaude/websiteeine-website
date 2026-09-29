/**
 * /appeals/:id — case link, statement, status, assignment (appeal:assign), decision (appeal:decide),
 * withdrawal by the submitter (§11.5).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { Permission, type AppealAssignRequest, type AppealDecisionRequest, type AppealView } from '@scpsl-trust/shared';

import { appealKeys, assignAppeal, decideAppeal, getAppeal, withdrawAppeal } from '../../api/appeals';
import { ApiError, getErrorMessage } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateTime } from '../../components/DateTime';
import { ErrorState } from '../../components/ErrorState';
import { KeyValueList } from '../../components/KeyValueList';
import { CaseLink, UserIdLink } from '../../components/Links';
import { ConfirmDialog } from '../../components/Modal';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { ForbiddenPage } from '../errors/ForbiddenPage';
import { NotFoundPage } from '../errors/NotFoundPage';
import { AppealAssignDialog } from './AppealAssignDialog';
import { AppealDecisionForm } from './AppealDecisionForm';
import { DECISION_LABELS, isAppealOpen } from './appealUtils';

function DecisionSummary({ appeal }: { appeal: AppealView }) {
  if (appeal.decision === null) return null;
  return (
    <Card title="Decision">
      <div className="stack-sm">
        <div className="row">
          <StatusBadge kind="appealDecision" value={appeal.decision} label={DECISION_LABELS[appeal.decision]} />
          {appeal.conflict_override && <Badge tone="warning" title="Decided despite a conflict of interest (super_admin override)">conflict override</Badge>}
          <span className="text-sm text-muted">
            by {appeal.decided_by?.pseudonym ?? 'a reviewer'} <DateTime value={appeal.decided_at} />
          </span>
        </div>
        {appeal.decision_reason !== null && appeal.decision_reason !== '' && (
          <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>
            {appeal.decision_reason}
          </div>
        )}
      </div>
    </Card>
  );
}

export function AppealDetailPage() {
  const { id = '' } = useParams<{ id: string }>();
  const auth = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [assignOpen, setAssignOpen] = useState(false);
  const [withdrawOpen, setWithdrawOpen] = useState(false);

  const appeal = useQuery({ queryKey: appealKeys.detail(id), queryFn: () => getAppeal(id), enabled: id !== '' });

  const refresh = async (updated: AppealView) => {
    queryClient.setQueryData(appealKeys.detail(id), updated);
    await queryClient.invalidateQueries({ queryKey: appealKeys.lists() });
  };

  const assign = useMutation({
    mutationFn: (body: AppealAssignRequest) => assignAppeal(id, body),
    onSuccess: async (updated) => {
      toast.success(`Assigned to ${updated.assigned_reviewer?.pseudonym ?? 'the reviewer'}.`);
      await refresh(updated);
    },
  });
  const decide = useMutation({
    mutationFn: (body: AppealDecisionRequest) => decideAppeal(id, body),
    onSuccess: async (updated) => {
      toast.success('Appeal decided. The case review history was updated.');
      await refresh(updated);
    },
  });
  const withdraw = useMutation({
    mutationFn: () => withdrawAppeal(id),
    onSuccess: async (updated) => {
      setWithdrawOpen(false);
      toast.success('Appeal withdrawn.');
      await refresh(updated);
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  if (id === '') return <NotFoundPage />;
  if (appeal.isPending) {
    return (
      <>
        <PageHeader title="Appeal" breadcrumbs={[{ label: 'Appeals', to: '/appeals' }, { label: 'Appeal' }]} />
        <LoadingState />
      </>
    );
  }
  if (appeal.isError) {
    if (ApiError.is(appeal.error) && appeal.error.isForbidden) return <ForbiddenPage message="You may only view your own appeals." />;
    if (ApiError.is(appeal.error) && appeal.error.isNotFound) return <NotFoundPage />;
    return (
      <>
        <PageHeader title="Appeal" breadcrumbs={[{ label: 'Appeals', to: '/appeals' }, { label: 'Appeal' }]} />
        <ErrorState error={appeal.error} onRetry={() => void appeal.refetch()} />
      </>
    );
  }

  const data = appeal.data;
  const open = isAppealOpen(data);
  const isSubmitter = auth.user !== null && auth.user.id === data.submitted_by.id;
  const canAssign = auth.hasPermission(Permission.APPEAL_ASSIGN) && open;
  const canDecide = auth.hasPermission(Permission.APPEAL_DECIDE) && open;
  const canWithdraw = isSubmitter && open;

  return (
    <>
      <PageHeader
        title={`Appeal on ${data.case_number}`}
        documentTitle={`Appeal ${data.case_number}`}
        breadcrumbs={[{ label: 'Appeals', to: '/appeals' }, { label: data.case_number }]}
        badges={<StatusBadge kind="appealStatus" value={data.status} dot />}
        actions={
          <>
            {canAssign && (
              <Button onClick={() => setAssignOpen(true)}>{data.assigned_reviewer === null ? 'Assign reviewer' : 'Reassign'}</Button>
            )}
            {canWithdraw && (
              <Button variant="danger" onClick={() => setWithdrawOpen(true)}>
                Withdraw appeal
              </Button>
            )}
          </>
        }
      />

      <div className="stack">
        <div className="grid-2">
          <Card title="Appeal">
            <KeyValueList
              items={[
                { label: 'Case', value: <CaseLink caseNumber={data.case_number} /> },
                { label: 'Player', value: <UserIdLink userId={data.player.user_id} displayName={data.player.display_name} showType /> },
                { label: 'Submitted by', value: data.submitted_by.username },
                { label: 'Submitted', value: <DateTime value={data.created_at} /> },
                { label: 'Status', value: <StatusBadge kind="appealStatus" value={data.status} /> },
                { label: 'Assigned reviewer', value: data.assigned_reviewer === null ? <span className="text-faint">unassigned</span> : data.assigned_reviewer.pseudonym },
                { label: 'Updated', value: <DateTime value={data.updated_at} /> },
              ]}
            />
          </Card>
          <Card title="Statement">
            <div className="text-sm" style={{ whiteSpace: 'pre-wrap' }}>
              {data.statement}
            </div>
          </Card>
        </div>

        <DecisionSummary appeal={data} />

        {canDecide && (
          <Card title="Decide">
            <div className="alert alert-info mb-4">
              <div className="alert-title">Independence rule</div>
              The reviewer who set the verdict and any reporter on the case cannot decide this appeal; the backend rejects such decisions with a conflict of
              interest.
            </div>
            <AppealDecisionForm
              appeal={data}
              onSubmit={async (body) => {
                await decide.mutateAsync(body);
              }}
            />
          </Card>
        )}

        {!open && !canDecide && data.status === 'withdrawn' && (
          <div className="alert alert-info">This appeal was withdrawn by the submitter.</div>
        )}
      </div>

      {assignOpen && (
        <AppealAssignDialog
          appeal={data}
          onSubmit={async (body) => {
            await assign.mutateAsync(body);
          }}
          onClose={() => setAssignOpen(false)}
        />
      )}
      <ConfirmDialog
        open={withdrawOpen}
        title="Withdraw appeal"
        message="Withdrawing closes this appeal without a decision. You cannot reopen it, but you may submit a new appeal for the case later if it is still appealable."
        confirmLabel="Withdraw"
        tone="danger"
        loading={withdraw.isPending}
        onConfirm={() => withdraw.mutate()}
        onCancel={() => setWithdrawOpen(false)}
      />
    </>
  );
}

export default AppealDetailPage;
