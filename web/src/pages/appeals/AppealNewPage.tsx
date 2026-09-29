/**
 * /appeals/new?case=CASE-… — statement form (§11.5). Requires a linked in-game identity whose
 * player is the case player; only confirmed/inconclusive cases can be appealed.
 */
import { useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';

import { AppealCreateRequestSchema, LIMITS, Permission } from '@scpsl-trust/shared';

import { appealKeys, createAppeal } from '../../api/appeals';
import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { Button, LinkButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { FormError } from '../../components/ErrorState';
import { Input, Textarea } from '../../components/FormField';
import { PageHeader } from '../../components/PageHeader';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { appealPath } from './appealUtils';

function statementHint(value: string): string {
  const length = value.trim().length;
  return `${length} / ${LIMITS.APPEAL_STATEMENT_MAX} characters (at least ${LIMITS.APPEAL_STATEMENT_MIN}).`;
}

export function AppealNewPage() {
  const auth = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams] = useSearchParams();
  const linked = auth.me?.linked_player ?? null;

  const form = useZodForm({
    schema: AppealCreateRequestSchema,
    initialValues: { case_id: (searchParams.get('case') ?? '').toUpperCase(), statement: '' },
    onSubmit: async (values) => {
      const appeal = await createAppeal(values);
      await queryClient.invalidateQueries({ queryKey: appealKeys.all });
      toast.success('Appeal submitted. A reviewer who was not involved in the case will decide.');
      void navigate(appealPath(appeal.id), { replace: true });
    },
  });

  const error = form.formError;
  const code = ApiError.is(error) ? error.code : null;

  return (
    <>
      <PageHeader title="New appeal" breadcrumbs={[{ label: 'Appeals', to: '/appeals' }, { label: 'New' }]} />
      <div className="grid-2">
        <Card title="Statement">
          {linked === null && (
            <div className="alert alert-warning mb-4">
              <div className="alert-title">A linked in-game account is required.</div>
              Appeals can only be submitted by the player the case is about. <Link to="/account">Link your Steam, Discord or Northwood identity under Profile</Link>{' '}
              first.
            </div>
          )}
          <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
            <Input label="Case number" mono required placeholder="CASE-2026-000001" hint="Shown on the case page and in the kick/ban message of the server." {...form.field('case_id')} />
            <Textarea
              label="Your statement"
              required
              rows={8}
              maxLength={LIMITS.APPEAL_STATEMENT_MAX}
              hint={statementHint(form.values.statement)}
              placeholder="Explain why you believe the verdict is wrong. Stick to facts; reviewers can see the evidence and the review history."
              {...form.field('statement')}
            />
            {code === 'PLAYER_NOT_LINKED' ? (
              <div className="alert alert-danger" role="alert">
                Your account is not linked to an in-game identity. <Link to="/account">Link it under Profile</Link>, then submit the appeal again.
              </div>
            ) : code === 'APPEAL_NOT_ALLOWED' ? (
              <div className="alert alert-danger" role="alert">
                This case cannot be appealed: only confirmed or inconclusive verdicts can be appealed, and only by the player the case is about.
              </div>
            ) : code === 'ALREADY_EXISTS' || code === 'CONFLICT' ? (
              <div className="alert alert-danger" role="alert">
                There is already an open appeal for this case. <Link to="/appeals">See your appeals</Link>.
              </div>
            ) : (
              <FormError error={error} />
            )}
            <div className="form-actions">
              <Button type="submit" variant="primary" loading={form.submitting} disabled={linked === null || !auth.hasPermission(Permission.APPEAL_CREATE)}>
                Submit appeal
              </Button>
              <LinkButton to="/appeals" variant="ghost">
                Cancel
              </LinkButton>
            </div>
          </form>
        </Card>
        <Card title="How appeals work">
          <ol className="stack-sm text-sm" style={{ paddingLeft: 'var(--sp-4)' }}>
            <li>Only the player the case is about can appeal, through their linked in-game identity. One open appeal per case.</li>
            <li>Only confirmed or inconclusive verdicts can be appealed.</li>
            <li>An independent reviewer decides — never the reviewer who set the verdict and never a reporter on the case.</li>
            <li>Outcomes: the verdict is confirmed, reversed (case rejected) or set to inconclusive. Every step is audited.</li>
            <li>You can withdraw the appeal while it is open.</li>
          </ol>
        </Card>
      </div>
    </>
  );
}

export default AppealNewPage;
