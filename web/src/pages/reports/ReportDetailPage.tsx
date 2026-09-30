/**
 * Report detail (`GET /reports/{id}`) with the status change form (`POST /reports/{id}/status`,
 * report:review — a note is mandatory and the change is audited).
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useParams } from 'react-router';

import { LIMITS, Permission, REPORT_STATUSES, ReportStatusChangeRequestSchema, type ReportView } from '@scpsl-trust/shared';

import { caseKeys } from '../../api/cases';
import { changeReportStatus, getReport, reportKeys } from '../../api/reports';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateTime } from '../../components/DateTime';
import { ErrorState, FormError } from '../../components/ErrorState';
import { Select, Textarea } from '../../components/FormField';
import { KeyValueList } from '../../components/KeyValueList';
import { CaseLink, ServerLink, UserIdLink } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { ReporterCell } from '../cases/CaseSections';
import { EvidenceUploadModal } from '../evidence/EvidenceUploadModal';
import { lengthHint } from '../cases/formHelpers';

const STATUS_OPTIONS = REPORT_STATUSES.map((value) => ({ value, label: humanizeEnum(value) }));

function ReportStatusForm({ report }: { report: ReportView }) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: (body: Parameters<typeof changeReportStatus>[1]) => changeReportStatus(report.id, body) });
  const form = useZodForm({
    schema: ReportStatusChangeRequestSchema,
    initialValues: { status: report.status, note: '' },
    onSubmit: async (body) => {
      await mutation.mutateAsync(body);
      await Promise.all([queryClient.invalidateQueries({ queryKey: reportKeys.all }), queryClient.invalidateQueries({ queryKey: caseKeys.all })]);
      toast.success(`Report marked ${humanizeEnum(body.status).toLowerCase()}.`);
      form.reset({ status: body.status, note: '' });
    },
  });

  return (
    <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate aria-label="Change report status">
      <p className="text-sm text-muted">
        Changing a report&apos;s status records your note in the audit log. It does not change the case verdict — reviewers decide that on the case page.
      </p>
      <Select {...form.field('status')} label="New status" options={STATUS_OPTIONS} required disabled={form.submitting} />
      <Textarea
        {...form.field('note')}
        label="Note"
        rows={4}
        required
        hint={lengthHint(form.values.note, LIMITS.REPORT_NOTE_MAX, LIMITS.REPORT_NOTE_MIN)}
        disabled={form.submitting}
      />
      <FormError error={form.formError} />
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={form.submitting} disabled={form.values.status === report.status && form.values.note.trim() === ''}>
          Save status
        </Button>
      </div>
    </form>
  );
}

export function ReportDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const auth = useAuth();
  const report = useQuery({ queryKey: reportKeys.detail(id), queryFn: () => getReport(id), enabled: id !== '' });
  const [uploadOpen, setUploadOpen] = useState(false);

  const breadcrumbs = [{ label: 'Reports', to: '/reports' }, { label: id.slice(0, 8) }];

  if (report.isPending) {
    return (
      <>
        <PageHeader title="Report" breadcrumbs={breadcrumbs} />
        <LoadingState />
      </>
    );
  }
  if (report.isError) {
    return (
      <>
        <PageHeader title="Report" breadcrumbs={breadcrumbs} />
        <ErrorState error={report.error} onRetry={() => void report.refetch()} />
      </>
    );
  }

  const data = report.data;
  const canReview = auth.hasPermission(Permission.REPORT_REVIEW);
  // The reporting user may add evidence to the case (§11.3) but only sees the public case view,
  // so the upload is offered here, on their own report.
  const isReporter = auth.user !== null && data.reporter_user?.id === auth.user.id;
  const canUpload = isReporter || auth.hasPermission(Permission.EVIDENCE_UPLOAD);

  return (
    <>
      <PageHeader
        title={data.reason}
        documentTitle={`Report ${data.id.slice(0, 8)}`}
        breadcrumbs={breadcrumbs}
        badges={
          <span className="row" style={{ marginLeft: 8, display: 'inline-flex' }}>
            <StatusBadge kind="reportStatus" value={data.status} dot />
          </span>
        }
        subtitle={
          <span className="row">
            <span>
              Case <CaseLink caseNumber={data.case_number} />
            </span>
            <span className="text-muted">
              · submitted <DateTime value={data.created_at} />
            </span>
          </span>
        }
      />
      <div className="grid-2">
        <Card title="Report">
          <KeyValueList
            items={[
              { label: 'Report id', value: <span className="mono text-xs break-all">{data.id}</span> },
              { label: 'Case', value: <CaseLink caseNumber={data.case_number} /> },
              { label: 'Reported player', value: <UserIdLink userId={data.player.user_id} displayName={data.player.display_name} showType /> },
              { label: 'Reporter', value: <ReporterCell report={data} /> },
              { label: 'Server', value: data.server === null ? null : <ServerLink serverId={data.server.server_id} name={data.server.name} /> },
              { label: 'Reason', value: data.reason },
              { label: 'Description', value: data.description === null ? null : <span style={{ whiteSpace: 'pre-wrap' }}>{data.description}</span> },
              { label: 'Status', value: <StatusBadge kind="reportStatus" value={data.status} dot /> },
              {
                label: 'Resolution',
                value:
                  data.resolved_at === null ? null : (
                    <span className="stack-sm" style={{ gap: 2 }}>
                      <span>
                        {data.resolved_by?.pseudonym ?? 'Reviewer'} · <DateTime value={data.resolved_at} />
                      </span>
                      {data.resolution_note !== null && <span style={{ whiteSpace: 'pre-wrap' }}>{data.resolution_note}</span>}
                    </span>
                  ),
              },
              { label: 'Evidence attached', value: data.evidence_count },
              { label: 'Submitted', value: <DateTime value={data.created_at} /> },
              { label: 'Updated', value: <DateTime value={data.updated_at} /> },
            ]}
          />
          <hr className="divider" />
          <p className="text-xs text-muted" style={{ margin: 0 }}>
            A report is a claim. It never changes the verdict by itself; evidence is reviewed and the verdict is decided on the case page.
          </p>
        </Card>
        {(canReview || canUpload) && (
          <div className="stack">
            {canUpload && (
              <Card
                title="Evidence"
                actions={
                  <Button size="sm" variant="primary" onClick={() => setUploadOpen(true)}>
                    Add evidence
                  </Button>
                }
              >
                <p className="text-sm text-muted" style={{ margin: 0 }}>
                  Recordings, screenshots or logs help reviewers decide. Uploaded items are attached to case{' '}
                  <CaseLink caseNumber={data.case_number} /> and linked to this report.
                </p>
              </Card>
            )}
            {canReview && (
              <Card title="Change status">
                <ReportStatusForm report={data} />
              </Card>
            )}
          </div>
        )}
      </div>
      {canUpload && (
        <EvidenceUploadModal
          open={uploadOpen}
          caseNumber={data.case_number}
          reports={[data]}
          defaultReportId={data.id}
          onClose={() => setUploadOpen(false)}
          onCreated={() => void report.refetch()}
        />
      )}
    </>
  );
}

export default ReportDetailPage;
