import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { CaseCreateRequestSchema, LIMITS } from '@scpsl-trust/shared';

import { createCase, caseKeys } from '../../api/cases';
import { Button } from '../../components/Button';
import { FormError } from '../../components/ErrorState';
import { Textarea } from '../../components/FormField';
import { casePath } from '../../components/Links';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { PlayerRefField } from '../players/PlayerRefField';
import { lengthHint } from './formHelpers';

export interface NewCaseModalProps {
  open: boolean;
  onClose: () => void;
}

/** `POST /cases` (case:create) — a case without a report, e.g. opened by a moderator from external evidence. */
export function NewCaseModal({ open, onClose }: NewCaseModalProps) {
  const navigate = useNavigate();
  const toast = useToast();
  const queryClient = useQueryClient();

  const mutation = useMutation({ mutationFn: createCase });
  const form = useZodForm({
    schema: CaseCreateRequestSchema,
    initialValues: { player: { type: 'steam', id: '' }, reason: '', public_summary: '' },
    onSubmit: async (values) => {
      const created = await mutation.mutateAsync(values);
      await queryClient.invalidateQueries({ queryKey: caseKeys.lists() });
      toast.success(`Case ${created.case_number} created.`);
      onClose();
      void navigate(casePath(created.case_number));
    },
  });

  const close = () => {
    if (form.submitting) return;
    form.reset();
    onClose();
  };

  return (
    <Modal
      open={open}
      title="New case"
      onClose={close}
      locked={form.submitting}
      footer={
        <>
          <Button onClick={close} disabled={form.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="new-case-form" loading={form.submitting}>
            Create case
          </Button>
        </>
      }
    >
      <form id="new-case-form" className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <p className="text-sm text-muted">
          A new case starts with verdict <strong>unknown</strong>. Reports and evidence never change a verdict by themselves; a reviewer sets it.
        </p>
        <PlayerRefField value={form.values.player} onChange={(player) => form.setValue('player', player)} errors={form.errors} disabled={form.submitting} />
        <Textarea
          {...form.field('reason')}
          label="Reason (internal summary)"
          rows={4}
          required
          hint={lengthHint(form.values.reason, LIMITS.CASE_REASON_MAX, LIMITS.CASE_REASON_MIN)}
          disabled={form.submitting}
        />
        <Textarea
          {...form.field('public_summary')}
          label="Public summary (optional)"
          rows={3}
          hint={`Shown on the public case page. ${lengthHint(form.values.public_summary, LIMITS.CASE_PUBLIC_SUMMARY_MAX)}`}
          disabled={form.submitting}
        />
        <FormError error={form.formError} />
      </form>
    </Modal>
  );
}
