/**
 * Submit a report (`POST /reports`, report:create). The backend attaches it to the player's
 * open case or opens a new one; 1 open report per reporter per player, 10 reports/hour.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { ErrorCode, LIMITS, ReportCreateRequestSchema } from '@scpsl-trust/shared';

import { ApiError } from '../../api/client';
import { createReport, reportKeys } from '../../api/reports';
import { listServers, serverKeys } from '../../api/servers';
import { caseKeys } from '../../api/cases';
import { Button, LinkButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/ErrorState';
import { Input, Select, Textarea } from '../../components/FormField';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { lengthHint, optionalServerIdInput } from '../cases/formHelpers';
import { PlayerRefField } from '../players/PlayerRefField';
import { reportPath } from '../cases/CaseSections';

const FormSchema = ReportCreateRequestSchema.extend({ server_id: optionalServerIdInput });

/** Friendly wording for the backend's business-rule refusals (the rules live in the backend). */
export function explainReportError(error: unknown): string | null {
  if (!ApiError.is(error)) return null;
  if (error.code === ErrorCode.RATE_LIMITED || error.status === 429) return 'You have reached the report limit (10 reports per hour). Please try again later.';
  if (error.code === ErrorCode.OPEN_REPORT_EXISTS) return 'You already have an open report on this player. Wait until a reviewer resolves it before reporting again.';
  if (error.code === ErrorCode.SERVER_NOT_ACTIVE) return 'The selected server is not active; leave the server empty or pick another one.';
  return null;
}

export function ReportNewPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  // Servers the user belongs to (GET /servers); anyone else can still type a server id.
  const servers = useQuery({ queryKey: serverKeys.list({ page_size: 100 }), queryFn: () => listServers({ page_size: 100 }), staleTime: 60_000 });
  const serverOptions = (servers.data?.items ?? []).map((server) => ({ value: server.server_id, label: `${server.name} (${server.server_id})` }));

  const mutation = useMutation({ mutationFn: createReport });
  const form = useZodForm({
    schema: FormSchema,
    initialValues: { player: { type: 'steam', id: '' }, reason: '', description: '', server_id: '' },
    onSubmit: async (body) => {
      const created = await mutation.mutateAsync(body);
      await Promise.all([queryClient.invalidateQueries({ queryKey: reportKeys.all }), queryClient.invalidateQueries({ queryKey: caseKeys.all })]);
      toast.success(`Report submitted and attached to case ${created.case_id}.`);
      void navigate(reportPath(created.report_id));
    },
  });

  const explanation = explainReportError(form.formError);

  return (
    <>
      <PageHeader title="New report" breadcrumbs={[{ label: 'Reports', to: '/reports' }, { label: 'New' }]} />
      <div className="grid-2">
        <Card title="Report a player">
          <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
            <PlayerRefField value={form.values.player} onChange={(player) => form.setValue('player', player)} errors={form.errors} disabled={form.submitting} />
            <Input
              {...form.field('reason')}
              label="Reason (short)"
              required
              maxLength={LIMITS.REPORT_REASON_MAX}
              hint={`One line, e.g. "aimbot / wallhack on Surface". ${lengthHint(form.values.reason, LIMITS.REPORT_REASON_MAX, LIMITS.REPORT_REASON_MIN)}`}
              disabled={form.submitting}
            />
            <Textarea
              {...form.field('description')}
              label="Description (optional)"
              rows={6}
              hint={`What happened, when, round/map, other witnesses. ${lengthHint(form.values.description, LIMITS.REPORT_DESCRIPTION_MAX)}`}
              disabled={form.submitting}
            />
            {serverOptions.length > 0 ? (
              <Select
                {...form.field('server_id')}
                label="Server where it happened (optional)"
                options={serverOptions}
                placeholder="Not specified"
                hint="Servers you are a member of. Leave empty if it happened elsewhere."
                disabled={form.submitting}
              />
            ) : (
              <Input
                {...form.field('server_id')}
                label="Server id where it happened (optional)"
                mono
                placeholder="srv_…"
                hint="The public server id shown by the server (srv_ followed by 16 characters)."
                disabled={form.submitting}
              />
            )}
            {explanation !== null && (
              <div className="alert alert-warning" role="alert">
                {explanation}
              </div>
            )}
            <FormError error={form.formError} />
            <div className="form-actions">
              <LinkButton to="/reports" variant="ghost">
                Cancel
              </LinkButton>
              <Button type="submit" variant="primary" loading={form.submitting}>
                Submit report
              </Button>
            </div>
          </form>
        </Card>
        <Card title="What happens next">
          <ul className="text-sm" style={{ margin: 0, paddingLeft: '1.2em' }}>
            <li>Your report is attached to the player&apos;s open case, or a new case with verdict <strong>unknown</strong> is opened.</li>
            <li>Reports are claims, not findings. Three reports do not equal guilt — only a reviewer&apos;s decision sets a verdict.</li>
            <li>You can add evidence (recordings, screenshots, logs) on the case page afterwards.</li>
            <li>One open report per player at a time; at most 10 reports per hour.</li>
            <li>Reports are never deleted; status changes are recorded with a note and audited.</li>
          </ul>
        </Card>
      </div>
    </>
  );
}

export default ReportNewPage;
