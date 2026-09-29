/**
 * Review actions on a case (§11.2): start review / note / reopen (a comment each) and the
 * verdict dialog. The backend enforces every rule; the dialogs explain them and surface
 * INSUFFICIENT_EVIDENCE / CONFLICT_OF_INTEREST clearly.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import {
  CaseCommentRequestSchema,
  CaseVerdictRequestSchema,
  ErrorCode,
  LIMITS,
  type CaseStaffView,
  type CaseVerdict,
} from '@scpsl-trust/shared';

import { ApiError } from '../../api/client';
import { addCaseNote, caseKeys, reopenCase, setCaseVerdict, startCaseReview } from '../../api/cases';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { FormError } from '../../components/ErrorState';
import { Select, Textarea } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { supportsConfirmedVerdict } from '../evidence/EvidenceAssessments';
import { lengthHint } from './formHelpers';

export type CaseCommentAction = 'start' | 'note' | 'reopen';

const COMMENT_ACTIONS: Readonly<Record<CaseCommentAction, { title: string; label: string; hint: string; success: string }>> = {
  start: {
    title: 'Start review',
    label: 'Start review',
    hint: 'Moves the case to "under review" and records you (by pseudonym) as a reviewer.',
    success: 'Review started.',
  },
  note: {
    title: 'Add note',
    label: 'Add note',
    hint: 'Notes are part of the permanent review history and cannot be edited or deleted.',
    success: 'Note added.',
  },
  reopen: {
    title: 'Reopen case',
    label: 'Reopen',
    hint: 'Reopening moves the case back to "under review". The previous verdict stays in the history.',
    success: 'Case reopened.',
  },
};

export interface CaseCommentModalProps {
  caseNumber: string;
  action: CaseCommentAction | null;
  onClose: () => void;
}

export function CaseCommentModal({ caseNumber, action, onClose }: CaseCommentModalProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (input: { action: CaseCommentAction; comment: string }) => {
      const body = { comment: input.comment };
      if (input.action === 'start') return startCaseReview(caseNumber, body);
      if (input.action === 'reopen') return reopenCase(caseNumber, body);
      return addCaseNote(caseNumber, body);
    },
  });
  const form = useZodForm({
    schema: CaseCommentRequestSchema,
    initialValues: { comment: '' },
    onSubmit: async ({ comment }) => {
      if (action === null) return;
      await mutation.mutateAsync({ action, comment });
      await queryClient.invalidateQueries({ queryKey: caseKeys.all });
      toast.success(COMMENT_ACTIONS[action].success);
      form.reset();
      onClose();
    },
  });

  const close = () => {
    if (form.submitting) return;
    form.reset();
    onClose();
  };

  const config = action === null ? null : COMMENT_ACTIONS[action];

  return (
    <Modal
      open={action !== null}
      title={config?.title ?? ''}
      onClose={close}
      locked={form.submitting}
      footer={
        <>
          <Button onClick={close} disabled={form.submitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="case-comment-form" loading={form.submitting}>
            {config?.label ?? 'Save'}
          </Button>
        </>
      }
    >
      <form id="case-comment-form" className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        {config !== null && <p className="text-sm text-muted">{config.hint}</p>}
        <Textarea
          {...form.field('comment')}
          label="Comment"
          rows={5}
          required
          hint={lengthHint(form.values.comment, LIMITS.REVIEW_COMMENT_MAX, LIMITS.REVIEW_COMMENT_MIN)}
          disabled={form.submitting}
          data-autofocus
        />
        <FormError error={form.formError} />
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Verdict
// ---------------------------------------------------------------------------

const VERDICT_OPTIONS: ReadonlyArray<{ value: Exclude<CaseVerdict, 'unknown'>; label: string }> = [
  { value: 'confirmed', label: 'Confirmed — cheating demonstrated by verified, authentic evidence' },
  { value: 'inconclusive', label: 'Inconclusive — reviewed, no determination possible' },
  { value: 'rejected', label: 'Rejected — the reports are not substantiated' },
];

export interface CaseVerdictModalProps {
  open: boolean;
  caseData: CaseStaffView;
  onClose: () => void;
}

/** Translates the backend rule violations into actionable text (the rules themselves live in the backend). */
export function explainVerdictError(error: unknown): string | null {
  if (!ApiError.is(error)) return null;
  switch (error.code) {
    case ErrorCode.INSUFFICIENT_EVIDENCE:
      return 'A "confirmed" verdict requires at least one piece of evidence (not superseded) whose authenticity AND cheating assessments are both "verified". Review the evidence first, or choose "inconclusive".';
    case ErrorCode.CONFLICT_OF_INTEREST:
      return 'You are a reporter on this case, so you cannot decide it. Another reviewer has to set the verdict.';
    case ErrorCode.MFA_ENROLLMENT_REQUIRED:
      return 'Setting a verdict requires a session verified with two-factor authentication. Enable 2FA under Account › Security and sign in again.';
    default:
      return null;
  }
}

export function CaseVerdictModal({ open, caseData, onClose }: CaseVerdictModalProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: (body: Parameters<typeof setCaseVerdict>[1]) => setCaseVerdict(caseData.case_number, body) });

  const form = useZodForm({
    schema: CaseVerdictRequestSchema,
    initialValues: { verdict: 'inconclusive', comment: '', public_summary: caseData.public_summary ?? '' },
    onSubmit: async (body) => {
      await mutation.mutateAsync(body);
      await queryClient.invalidateQueries({ queryKey: caseKeys.all });
      toast.success(`Verdict set to ${humanizeEnum(body.verdict).toLowerCase()}.`);
      form.reset();
      onClose();
    },
  });

  const close = () => {
    if (form.submitting) return;
    form.reset();
    onClose();
  };

  const supporting = caseData.evidence.filter(supportsConfirmedVerdict).length;
  const wantsConfirmed = form.values.verdict === 'confirmed';
  const explanation = explainVerdictError(form.formError);

  return (
    <Modal
      open={open}
      title="Set verdict"
      onClose={close}
      locked={form.submitting}
      size="lg"
      footer={
        <>
          <Button onClick={close} disabled={form.submitting}>
            Cancel
          </Button>
          <Button variant={wantsConfirmed ? 'danger' : 'primary'} type="submit" form="case-verdict-form" loading={form.submitting}>
            Set verdict
          </Button>
        </>
      }
    >
      <form id="case-verdict-form" className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
        <div className="alert alert-info text-sm">
          <div className="alert-title">Rules enforced by the backend</div>
          <ul style={{ margin: 0, paddingLeft: '1.2em' }}>
            <li>
              <strong>Confirmed</strong> needs at least one non-superseded evidence item whose <em>authenticity</em> and <em>demonstrates cheating</em> assessments
              are both verified. Identity, authenticity and the verdict are separate questions.
            </li>
            <li>A reviewer who reported on this case cannot decide it (conflict of interest).</li>
            <li>Setting a verdict closes the case and resolves its open reports; a 2FA-verified session is required.</li>
            <li>Report counts and server confirmations never set a verdict.</li>
          </ul>
        </div>

        <div className="row text-sm">
          <span className="text-muted">Current verdict:</span>
          <StatusBadge kind="verdict" value={caseData.verdict} dot />
          <span className="text-muted">Evidence supporting "confirmed":</span>
          <Badge tone={supporting > 0 ? 'success' : 'warning'}>{supporting}</Badge>
        </div>

        <Select {...form.field('verdict')} label="Verdict" options={VERDICT_OPTIONS} required disabled={form.submitting} data-autofocus />
        {wantsConfirmed && supporting === 0 && (
          <div className="alert alert-warning text-sm" role="status">
            No evidence on this case currently has both "authentic" and "demonstrates cheating" verified. The backend will refuse a confirmed verdict
            (INSUFFICIENT_EVIDENCE) until evidence has been reviewed.
          </div>
        )}
        <Textarea
          {...form.field('comment')}
          label="Review comment (internal)"
          rows={5}
          required
          hint={lengthHint(form.values.comment, LIMITS.REVIEW_COMMENT_MAX, LIMITS.REVIEW_COMMENT_MIN)}
          disabled={form.submitting}
        />
        <Textarea
          {...form.field('public_summary')}
          label="Public summary (optional)"
          rows={3}
          hint={`Shown on the public case page and to the player. ${lengthHint(form.values.public_summary, LIMITS.CASE_PUBLIC_SUMMARY_MAX)}`}
          disabled={form.submitting}
        />
        {explanation !== null && (
          <div className="alert alert-danger" role="alert">
            <div className="alert-title">Verdict not accepted</div>
            {explanation}
          </div>
        )}
        <FormError error={form.formError} />
      </form>
    </Modal>
  );
}
