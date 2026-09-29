/**
 * Decision form (appeal:decide): confirm / reverse / inconclusive with a reason; super_admins may
 * override a conflict of interest (recorded and audited). CONFLICT_OF_INTEREST is surfaced clearly.
 */
import { APPEAL_DECISIONS, AppealDecisionRequestSchema, LIMITS, Permission, type AppealDecisionRequest, type AppealView } from '@scpsl-trust/shared';

import { ApiError } from '../../api/client';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/Button';
import { FormError } from '../../components/ErrorState';
import { Checkbox, Select, Textarea } from '../../components/FormField';
import { useZodForm } from '../../components/useZodForm';
import { DECISION_EFFECTS, DECISION_LABELS } from './appealUtils';

export interface AppealDecisionFormProps {
  appeal: AppealView;
  onSubmit: (body: AppealDecisionRequest) => Promise<void>;
}

export function AppealDecisionForm({ appeal, onSubmit }: AppealDecisionFormProps) {
  const auth = useAuth();
  const canOverride = auth.hasPermission(Permission.APPEAL_OVERRIDE_CONFLICT);
  const form = useZodForm({
    schema: AppealDecisionRequestSchema,
    initialValues: { decision: 'confirm', reason: '', override_conflict: false },
    onSubmit: async (values) => {
      await onSubmit(values);
    },
  });
  const error = form.formError;
  const conflict = ApiError.is(error) && error.code === 'CONFLICT_OF_INTEREST';
  const decision = form.values.decision;

  return (
    <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate aria-label="Decide appeal">
      <Select
        label="Decision"
        options={APPEAL_DECISIONS.map((value) => ({ value, label: DECISION_LABELS[value] }))}
        hint={decision !== undefined ? DECISION_EFFECTS[decision] : undefined}
        {...form.field('decision')}
      />
      <Textarea
        label="Reason"
        required
        rows={5}
        minLength={LIMITS.APPEAL_DECISION_REASON_MIN}
        maxLength={LIMITS.APPEAL_DECISION_REASON_MAX}
        hint={`${LIMITS.APPEAL_DECISION_REASON_MIN}–${LIMITS.APPEAL_DECISION_REASON_MAX} characters; recorded in the case review history.`}
        {...form.field('reason')}
      />
      {canOverride && (
        <div className="stack-sm">
          <Checkbox
            label="Override conflict of interest"
            hint="Only if you set the verdict or reported on this case. The override is recorded on the appeal and audited."
            {...form.checkbox('override_conflict')}
          />
          {form.values.override_conflict === true && (
            <div className="alert alert-warning" role="alert">
              <div className="alert-title">You are about to decide an appeal on a case you are involved in.</div>
              Independence is the rule (§11.5); use this only when no independent reviewer is available. The decision is marked as a conflict override.
            </div>
          )}
        </div>
      )}
      {conflict ? (
        <div className="alert alert-danger" role="alert">
          <div className="alert-title">Conflict of interest</div>
          You set the verdict of this case or reported on it, so you cannot decide this appeal. Assign it to another reviewer
          {canOverride ? ' or tick "Override conflict of interest" above' : ''}.
        </div>
      ) : (
        <FormError error={error} />
      )}
      <div className="form-actions">
        <Button type="submit" variant={decision === 'reverse' ? 'danger' : 'primary'} loading={form.submitting} disabled={appeal.status === 'decided' || appeal.status === 'withdrawn'}>
          {decision !== undefined ? DECISION_LABELS[decision] : 'Decide'}
        </Button>
      </div>
    </form>
  );
}
