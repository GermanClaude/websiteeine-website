/**
 * Replace an evidence file (§11.3): a NEW object is created with `supersedes_evidence_id`;
 * the old one is kept with `superseded_by_evidence_id`. Nothing is overwritten (R7).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router';
import type { z } from 'zod';

import { EVIDENCE_ALLOWED_MIME_TYPES, EvidenceSupersedeFieldsSchema, LIMITS, type EvidenceView } from '@scpsl-trust/shared';

import { isAbortError, type UploadProgress } from '../../api/client';
import { caseKeys } from '../../api/cases';
import { evidenceKeys, supersedeEvidence } from '../../api/evidence';
import { Button } from '../../components/Button';
import { CodeBlock } from '../../components/CodeBlock';
import { FormError } from '../../components/ErrorState';
import { Input, Textarea } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { formatBytes } from '../../lib/format';
import { lengthHint } from '../cases/formHelpers';

const FormSchema = EvidenceSupersedeFieldsSchema.extend({
  title: EvidenceSupersedeFieldsSchema.shape.title.unwrap().optional().or(EvidenceSupersedeFieldsSchema.shape.title),
});

export interface EvidenceSupersedeModalProps {
  open: boolean;
  evidence: EvidenceView;
  onClose: () => void;
}

export function EvidenceSupersedeModal({ open, evidence, onClose }: EvidenceSupersedeModalProps) {
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [created, setCreated] = useState<EvidenceView | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const mutation = useMutation({
    mutationFn: (input: { file: File; fields: z.output<typeof FormSchema> }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      return supersedeEvidence(evidence.id, { file: input.file, fields: { ...input.fields, title: input.fields.title === '' ? undefined : input.fields.title } }, setProgress, controller.signal);
    },
  });

  const form = useZodForm({
    schema: FormSchema,
    initialValues: { title: evidence.title, description: evidence.description ?? '', reason: '' },
    onSubmit: async (fields) => {
      if (file === null) {
        setFileError('Choose the replacement file.');
        return;
      }
      setFileError(undefined);
      setProgress({ loaded: 0, total: file.size, fraction: 0 });
      try {
        const next = await mutation.mutateAsync({ file, fields });
        setCreated(next);
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: evidenceKeys.all }),
          queryClient.invalidateQueries({ queryKey: caseKeys.detail(evidence.case_number) }),
        ]);
        toast.success('Replacement stored; the previous file is preserved.');
      } catch (error) {
        if (isAbortError(error)) {
          form.setFormError('Upload cancelled.');
          return;
        }
        throw error;
      } finally {
        setProgress(null);
        abortRef.current = null;
      }
    },
  });

  const close = () => {
    if (form.submitting) return;
    const next = created;
    form.reset();
    setFile(null);
    setFileError(undefined);
    setCreated(null);
    onClose();
    if (next !== null) void navigate(`/evidence/${encodeURIComponent(next.id)}`);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    setFile(event.target.files?.[0] ?? null);
    setFileError(undefined);
  };

  return (
    <Modal
      open={open}
      title={created !== null ? 'Evidence replaced' : 'Replace evidence file'}
      onClose={close}
      locked={form.submitting}
      footer={
        created !== null ? (
          <Button variant="primary" onClick={close}>
            Open the new item
          </Button>
        ) : (
          <>
            {form.submitting && abortRef.current !== null ? (
              <Button variant="danger" onClick={() => abortRef.current?.abort()}>
                Cancel upload
              </Button>
            ) : (
              <Button onClick={close}>Cancel</Button>
            )}
            <Button variant="primary" type="submit" form="evidence-supersede-form" loading={form.submitting}>
              Upload replacement
            </Button>
          </>
        )
      }
    >
      {created !== null ? (
        <div className="stack-sm">
          <p>
            New evidence <span className="mono text-xs">{created.id}</span> now supersedes <span className="mono text-xs">{evidence.id}</span>. Both remain in the
            case history; the new item starts as <strong>unverified</strong> and needs its own review.
          </p>
          {created.sha256 !== null && <CodeBlock value={created.sha256} inline />}
        </div>
      ) : (
        <form id="evidence-supersede-form" className="form" onSubmit={(event) => void form.handleSubmit(event)} noValidate>
          <div className="alert alert-warning text-sm">
            The current file is <strong>not</strong> deleted or modified. A new evidence object is created and linked to this one; reviews start over.
          </div>
          <Input
            label="Replacement file"
            type="file"
            accept={EVIDENCE_ALLOWED_MIME_TYPES.join(',')}
            onChange={onFileChange}
            error={fileError}
            hint={file === null ? 'Same allow-list as uploads.' : `${file.name} · ${formatBytes(file.size)}`}
            required
            disabled={form.submitting}
          />
          <Textarea
            {...form.field('reason')}
            label="Reason for replacing"
            rows={3}
            required
            hint={lengthHint(form.values.reason, LIMITS.REVOKE_REASON_MAX, LIMITS.REVOKE_REASON_MIN)}
            disabled={form.submitting}
          />
          <Input {...form.field('title')} label="Title (optional, keeps the current one when empty)" maxLength={LIMITS.EVIDENCE_TITLE_MAX} disabled={form.submitting} />
          <Textarea {...form.field('description')} label="Description (optional)" rows={3} hint={lengthHint(form.values.description, LIMITS.EVIDENCE_DESCRIPTION_MAX)} disabled={form.submitting} />
          {progress !== null && (
            <div className="stack-sm" aria-live="polite">
              <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.fraction === null ? undefined : Math.round(progress.fraction * 100)} aria-label="Upload progress">
                <div className="progress-bar" style={{ width: `${progress.fraction === null ? 100 : Math.round(progress.fraction * 100)}%` }} />
              </div>
              <div className="text-xs text-muted">{progress.fraction === null ? `${formatBytes(progress.loaded)} sent…` : `${Math.round(progress.fraction * 100)}%`}</div>
            </div>
          )}
          <FormError error={form.formError} />
        </form>
      )}
    </Modal>
  );
}
