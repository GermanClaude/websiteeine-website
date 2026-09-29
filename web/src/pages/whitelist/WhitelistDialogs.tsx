/**
 * Approve / reject / revoke dialogs for whitelist requests (ARCHITECTURE §11.6). Shared by the
 * whitelist page and the server "Whitelist & bypasses" tab.
 */
import { useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';

import { LIMITS, WhitelistDecisionRequestSchema, WhitelistRevokeRequestSchema, type WhitelistRequestView } from '@scpsl-trust/shared';

import { bypassKeys } from '../../api/bypasses';
import { serverKeys } from '../../api/servers';
import { decideWhitelistRequest, revokeWhitelistRequest, whitelistKeys } from '../../api/whitelist';
import { Button } from '../../components/Button';
import { FormError } from '../../components/ErrorState';
import { Input, Textarea } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { StatusBadge } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { intInput } from '../servers/lib/forms';

export type WhitelistDialogState = { kind: 'approve' | 'reject' | 'revoke'; request: WhitelistRequestView } | null;

const ApproveFormSchema = z.object({
  days: intInput({ min: 1, max: LIMITS.BYPASS_DAYS_MAX, label: 'Days' }),
  note: z.string().trim().max(LIMITS.WHITELIST_DECISION_NOTE_MAX),
});
const RejectFormSchema = z.object({
  note: z.string().trim().max(LIMITS.WHITELIST_DECISION_NOTE_MAX),
});

function RequestSummary({ request }: { request: WhitelistRequestView }) {
  return (
    <div className="text-sm stack-sm">
      <div className="row">
        <StatusBadge kind="whitelistType" value={request.type} />
        <span className="mono">{request.player.user_id}</span>
        <span className="text-muted">on {request.server.name}</span>
      </div>
      <div className="text-muted" style={{ whiteSpace: 'pre-wrap' }}>
        {request.reason}
      </div>
    </div>
  );
}

export function useWhitelistInvalidation() {
  const queryClient = useQueryClient();
  return async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: whitelistKeys.all }),
      queryClient.invalidateQueries({ queryKey: bypassKeys.all }),
      queryClient.invalidateQueries({ queryKey: serverKeys.all }),
    ]);
  };
}

function ApproveDialog({ request, onClose }: { request: WhitelistRequestView; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useWhitelistInvalidation();
  const form = useZodForm({
    schema: ApproveFormSchema,
    initialValues: { days: request.requested_days === null ? '' : String(request.requested_days), note: '' },
    onSubmit: async (values) => {
      const body = WhitelistDecisionRequestSchema.parse({ decision: 'approve', note: values.note, days: values.days });
      await decideWhitelistRequest(request.id, body);
      toast.success('Request approved — a bypass was created.');
      onClose();
      await invalidate();
    },
  });
  return (
    <Modal open title="Approve whitelist request" onClose={onClose} locked={form.submitting}>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <RequestSummary request={request} />
        <Input
          label="Valid for (days)"
          type="number"
          inputMode="numeric"
          min={1}
          max={LIMITS.BYPASS_DAYS_MAX}
          hint={request.requested_days === null ? 'Empty = no expiry (if the server allows permanent bypasses).' : `The player asked for ${request.requested_days} days. Empty = no expiry.`}
          data-autofocus
          {...form.field('days')}
        />
        <Textarea label="Note (optional, visible to the player)" rows={2} maxLength={LIMITS.WHITELIST_DECISION_NOTE_MAX} {...form.field('note')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant="primary" loading={form.submitting}>
            Approve
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RejectDialog({ request, onClose }: { request: WhitelistRequestView; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useWhitelistInvalidation();
  const form = useZodForm({
    schema: RejectFormSchema,
    initialValues: { note: '' },
    onSubmit: async (values) => {
      const body = WhitelistDecisionRequestSchema.parse({ decision: 'reject', note: values.note });
      await decideWhitelistRequest(request.id, body);
      toast.success('Request rejected.');
      onClose();
      await invalidate();
    },
  });
  return (
    <Modal open title="Reject whitelist request" onClose={onClose} locked={form.submitting}>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <RequestSummary request={request} />
        <Textarea label="Note (optional, visible to the player)" rows={3} maxLength={LIMITS.WHITELIST_DECISION_NOTE_MAX} data-autofocus {...form.field('note')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant="danger" loading={form.submitting}>
            Reject
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function RevokeDialog({ request, onClose }: { request: WhitelistRequestView; onClose: () => void }) {
  const toast = useToast();
  const invalidate = useWhitelistInvalidation();
  const form = useZodForm({
    schema: WhitelistRevokeRequestSchema,
    initialValues: { reason: '' },
    onSubmit: async (values) => {
      await revokeWhitelistRequest(request.id, values);
      toast.success('Whitelist revoked.');
      onClose();
      await invalidate();
    },
  });
  return (
    <Modal open title="Revoke approved whitelist" onClose={onClose} locked={form.submitting}>
      <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <RequestSummary request={request} />
        <p className="text-sm">The bypass created by this approval is revoked immediately. This is audited.</p>
        <Textarea label="Reason" required rows={3} minLength={LIMITS.REVOKE_REASON_MIN} maxLength={LIMITS.REVOKE_REASON_MAX} data-autofocus {...form.field('reason')} />
        <FormError error={form.formError} />
        <div className="form-actions">
          <Button type="submit" variant="danger" loading={form.submitting}>
            Revoke
          </Button>
          <Button variant="ghost" onClick={onClose} disabled={form.submitting}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}

export function WhitelistDialogs({ state, onClose }: { state: WhitelistDialogState; onClose: () => void }) {
  if (state === null) return null;
  if (state.kind === 'approve') return <ApproveDialog key={state.request.id} request={state.request} onClose={onClose} />;
  if (state.kind === 'reject') return <RejectDialog key={state.request.id} request={state.request} onClose={onClose} />;
  return <RevokeDialog key={state.request.id} request={state.request} onClose={onClose} />;
}
