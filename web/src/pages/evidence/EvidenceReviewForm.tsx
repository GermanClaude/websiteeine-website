/**
 * Evidence review (§11.3, R2): three SEPARATE questions — identity, authenticity, cheating —
 * plus an overall status and a comment. Reviewing evidence never changes the case verdict.
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';

import { EVIDENCE_STATUSES, EvidenceReviewRequestSchema, LIMITS, type EvidenceDetail, type EvidenceStatus } from '@scpsl-trust/shared';

import { caseKeys } from '../../api/cases';
import { evidenceKeys, reviewEvidence } from '../../api/evidence';
import { Button } from '../../components/Button';
import { FormError } from '../../components/ErrorState';
import { Select, Textarea } from '../../components/FormField';
import { humanizeEnum } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { lengthHint } from '../cases/formHelpers';
import { ASSESSMENT_QUESTIONS, EVIDENCE_STATUS_HELP } from './EvidenceAssessments';

const STATUS_OPTIONS = EVIDENCE_STATUSES.map((value) => ({ value, label: humanizeEnum(value) }));

/** Suggested overall status: rejected if any question is rejected, verified only when all three are, else inconclusive/unverified. */
export function suggestOverallStatus(identity: EvidenceStatus, authenticity: EvidenceStatus, cheating: EvidenceStatus): EvidenceStatus {
  const all = [identity, authenticity, cheating];
  if (all.includes('rejected')) return 'rejected';
  if (all.every((status) => status === 'verified')) return 'verified';
  if (all.every((status) => status === 'unverified')) return 'unverified';
  return 'inconclusive';
}

export interface EvidenceReviewFormProps {
  evidence: EvidenceDetail;
  onReviewed?: () => void;
}

export function EvidenceReviewForm({ evidence, onReviewed }: EvidenceReviewFormProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const mutation = useMutation({ mutationFn: (body: Parameters<typeof reviewEvidence>[1]) => reviewEvidence(evidence.id, body) });

  const form = useZodForm({
    schema: EvidenceReviewRequestSchema,
    initialValues: {
      identity_status: evidence.identity_status,
      authenticity_status: evidence.authenticity_status,
      cheating_status: evidence.cheating_status,
      status: evidence.status,
      comment: '',
    },
    onSubmit: async (body) => {
      await mutation.mutateAsync(body);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: evidenceKeys.all }),
        queryClient.invalidateQueries({ queryKey: caseKeys.detail(evidence.case_number) }),
      ]);
      toast.success('Evidence review recorded. The case verdict is unchanged.');
      form.reset({ ...body, comment: '' });
      onReviewed?.();
    },
  });

  const suggested = suggestOverallStatus(form.values.identity_status, form.values.authenticity_status, form.values.cheating_status);
  const superseded = evidence.superseded_by_evidence_id !== null;

  return (
    <form className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate aria-label="Review evidence">
      {superseded && (
        <div className="alert alert-warning text-sm" role="status">
          This item has been superseded. Reviews are still recorded, but the replacement is what supports the case.
        </div>
      )}
      <p className="text-sm text-muted">
        Answer each question on its own. A verified Overwatch session only supports the <em>identity</em> question. Your review never sets the
        case verdict; a reviewer decides that separately on the case page.
      </p>
      <div className="form-grid">
        {ASSESSMENT_QUESTIONS.map((item, index) => (
          <Select
            key={item.key}
            {...form.field(item.key)}
            label={`${index + 1}. ${item.question}`}
            options={STATUS_OPTIONS}
            required
            hint={EVIDENCE_STATUS_HELP[form.values[item.key]]}
            disabled={form.submitting}
          />
        ))}
      </div>
      <Select
        {...form.field('status')}
        label="Overall status"
        options={STATUS_OPTIONS}
        required
        hint={
          form.values.status === suggested
            ? EVIDENCE_STATUS_HELP[form.values.status]
            : `Suggested from the three answers: ${humanizeEnum(suggested).toLowerCase()}. You may choose differently and explain why.`
        }
        disabled={form.submitting}
      />
      <Textarea
        {...form.field('comment')}
        label="Review comment"
        rows={4}
        required
        hint={lengthHint(form.values.comment, LIMITS.REVIEW_COMMENT_MAX, LIMITS.REVIEW_COMMENT_MIN)}
        disabled={form.submitting}
      />
      <FormError error={form.formError} />
      <div className="form-actions">
        <Button type="submit" variant="primary" loading={form.submitting}>
          Record review
        </Button>
      </div>
    </form>
  );
}
