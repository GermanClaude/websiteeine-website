/**
 * Assign an appeal to a reviewer (appeal:assign). Reviewer accounts are looked up through
 * GET /admin/users (user:view, held by every role with appeal:assign); a UUID can be pasted too.
 */
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';

import { AppealAssignRequestSchema, Permission, UuidSchema, hasPermission, type AdminUser, type AppealAssignRequest, type AppealView } from '@scpsl-trust/shared';

import { adminUserKeys, listUsers } from '../../api/admin';
import { useAuth } from '../../auth/useAuth';
import { Button } from '../../components/Button';
import { FormError } from '../../components/ErrorState';
import { Input, Select } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { humanizeEnum } from '../../components/StatusBadge';
import { useZodForm } from '../../components/useZodForm';

export interface AppealAssignDialogProps {
  appeal: AppealView;
  onSubmit: (body: AppealAssignRequest) => Promise<void>;
  onClose: () => void;
}

const AssignFormSchema = z.object({
  reviewer_user_id: z.string().trim().pipe(UuidSchema),
});

function reviewerLabel(user: AdminUser): string {
  const pseudonym = user.reviewer_number === null ? '' : ` — Reviewer #${user.reviewer_number}`;
  return `${user.username} (${humanizeEnum(user.role)})${pseudonym}`;
}

export function AppealAssignDialog({ appeal, onSubmit, onClose }: AppealAssignDialogProps) {
  const auth = useAuth();
  const canListUsers = auth.hasPermission(Permission.USER_VIEW);
  const users = useQuery({
    queryKey: adminUserKeys.list({ purpose: 'reviewers' }),
    queryFn: () => listUsers({ status: 'active', page_size: 100 }),
    enabled: canListUsers,
    staleTime: 60_000,
  });
  const reviewers = (users.data?.items ?? []).filter((user) => hasPermission(user.role, Permission.APPEAL_DECIDE));

  const form = useZodForm({
    schema: AssignFormSchema,
    initialValues: { reviewer_user_id: '' },
    onSubmit: async (values) => {
      await onSubmit(AppealAssignRequestSchema.parse(values));
      onClose();
    },
  });

  return (
    <Modal open title="Assign appeal" onClose={onClose} locked={form.submitting}>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <p className="text-sm">
          Appeal on <span className="mono">{appeal.case_number}</span>
          {appeal.assigned_reviewer !== null && (
            <>
              , currently assigned to <strong>{appeal.assigned_reviewer.pseudonym}</strong>
            </>
          )}
          . Pick a reviewer who neither set the verdict nor reported on the case.
        </p>
        {canListUsers && reviewers.length > 0 ? (
          <Select
            label="Reviewer"
            placeholder="Select a reviewer…"
            options={reviewers.map((user) => ({ value: user.id, label: reviewerLabel(user) }))}
            data-autofocus
            {...form.field('reviewer_user_id')}
          />
        ) : (
          <Input
            label="Reviewer user id"
            mono
            required
            placeholder="UUID of the reviewer account"
            hint={canListUsers && users.isPending ? 'Loading reviewers…' : 'Paste the user id from the Users page.'}
            data-autofocus
            {...form.field('reviewer_user_id')}
          />
        )}
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.submitting}>
            Assign
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
