/**
 * Add evidence to a case: a file upload (multipart, progress bar, SHA-256 shown from the
 * backend response) or an https link. Evidence is immutable once stored (R7).
 */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState, type ChangeEvent } from 'react';
import type { z } from 'zod';

import {
  DEFAULT_EVIDENCE_MAX_BYTES,
  EVIDENCE_ALLOWED_MIME_TYPES,
  EVIDENCE_TYPES,
  EvidenceLinkCreateRequestSchema,
  EvidenceUploadFieldsSchema,
  LIMITS,
  type EvidenceView,
  type ReportView,
} from '@scpsl-trust/shared';

import { isAbortError, type UploadProgress } from '../../api/client';
import { caseKeys } from '../../api/cases';
import { createLinkEvidence, evidenceKeys, uploadEvidence } from '../../api/evidence';
import { Button } from '../../components/Button';
import { CodeBlock } from '../../components/CodeBlock';
import { FormError } from '../../components/ErrorState';
import { Input, Select, Textarea } from '../../components/FormField';
import { Modal } from '../../components/Modal';
import { humanizeEnum } from '../../components/StatusBadge';
import { useToast } from '../../components/Toasts';
import { useZodForm } from '../../components/useZodForm';
import { formatBytes } from '../../lib/format';
import { lengthHint, optionalUuidInput } from '../cases/formHelpers';

const UploadFormSchema = EvidenceUploadFieldsSchema.extend({
  report_id: optionalUuidInput,
  overwatch_session_id: optionalUuidInput,
});

const LinkFormSchema = EvidenceLinkCreateRequestSchema.extend({
  report_id: optionalUuidInput,
  overwatch_session_id: optionalUuidInput,
});

const FILE_TYPE_OPTIONS = EVIDENCE_TYPES.filter((type) => type !== 'link').map((type) => ({ value: type, label: humanizeEnum(type) }));
const ACCEPT = EVIDENCE_ALLOWED_MIME_TYPES.join(',');

export interface EvidenceUploadModalProps {
  open: boolean;
  caseNumber: string;
  /** Reports of the case (optional association). */
  reports?: readonly ReportView[];
  onClose: () => void;
  /** Pre-selected related report (e.g. when opened from that report's page). */
  defaultReportId?: string;
  /** Called with the created evidence after the modal was acknowledged. */
  onCreated?: (evidence: EvidenceView) => void;
}

type Mode = 'file' | 'link';

function reportLabel(report: ReportView): string {
  const who = report.reporter_user?.username ?? report.reporter_player?.user_id ?? humanizeEnum(report.reporter_type);
  return `${report.reason} — ${who} (${report.id.slice(0, 8)})`;
}

export function EvidenceUploadModal({ open, caseNumber, reports = [], defaultReportId = '', onClose, onCreated }: EvidenceUploadModalProps) {
  const [mode, setMode] = useState<Mode>('file');
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | undefined>(undefined);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [created, setCreated] = useState<EvidenceView | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const toast = useToast();
  const queryClient = useQueryClient();

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: caseKeys.detail(caseNumber) }),
      queryClient.invalidateQueries({ queryKey: evidenceKeys.all }),
    ]);
  };

  const upload = useMutation({
    mutationFn: (input: { file: File; fields: z.output<typeof UploadFormSchema> }) => {
      const controller = new AbortController();
      abortRef.current = controller;
      return uploadEvidence(caseNumber, input, setProgress, controller.signal);
    },
  });
  const link = useMutation({ mutationFn: (body: z.output<typeof LinkFormSchema>) => createLinkEvidence(caseNumber, body) });

  const fileForm = useZodForm({
    schema: UploadFormSchema,
    initialValues: { type: 'video', title: '', description: '', report_id: defaultReportId, overwatch_session_id: '' },
    onSubmit: async (fields) => {
      if (file === null) {
        setFileError('Choose a file to upload.');
        return;
      }
      setFileError(undefined);
      setProgress({ loaded: 0, total: file.size, fraction: 0 });
      try {
        const evidence = await upload.mutateAsync({ file, fields });
        setCreated(evidence);
        await invalidate();
        toast.success('Evidence uploaded.');
      } catch (error) {
        if (isAbortError(error)) {
          fileForm.setFormError('Upload cancelled.');
          return;
        }
        throw error;
      } finally {
        setProgress(null);
        abortRef.current = null;
      }
    },
  });

  const linkForm = useZodForm({
    schema: LinkFormSchema,
    initialValues: { url: '', title: '', description: '', report_id: defaultReportId, overwatch_session_id: '' },
    onSubmit: async (body) => {
      const evidence = await link.mutateAsync(body);
      setCreated(evidence);
      await invalidate();
      toast.success('Link evidence added.');
    },
  });

  const busy = fileForm.submitting || linkForm.submitting;

  const reset = () => {
    fileForm.reset();
    linkForm.reset();
    setFile(null);
    setFileError(undefined);
    setProgress(null);
    setCreated(null);
    setMode('file');
  };

  const close = () => {
    if (busy) return;
    const done = created;
    reset();
    onClose();
    if (done !== null) onCreated?.(done);
  };

  const onFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.files?.[0] ?? null;
    setFile(next);
    if (next !== null && next.size > DEFAULT_EVIDENCE_MAX_BYTES) {
      setFileError(`The file is larger than the default limit of ${formatBytes(DEFAULT_EVIDENCE_MAX_BYTES)}. The server may reject it.`);
    } else {
      setFileError(undefined);
    }
    if (next !== null && fileForm.values.title.trim() === '') fileForm.setValue('title', next.name.replace(/\.[^.]+$/, '').slice(0, LIMITS.EVIDENCE_TITLE_MAX));
  };

  const reportOptions = reports.map((report) => ({ value: report.id, label: reportLabel(report) }));

  const associationFields = (form: typeof fileForm | typeof linkForm) => (
    <div className="form-grid">
      {reportOptions.length > 0 ? (
        <Select {...form.field('report_id')} label="Related report (optional)" options={reportOptions} placeholder="None" disabled={busy} />
      ) : (
        <Input {...form.field('report_id')} label="Related report id (optional)" mono placeholder="uuid" disabled={busy} />
      )}
      <Input
        {...form.field('overwatch_session_id')}
        label="Overwatch session id (optional)"
        mono
        placeholder="uuid"
        hint="Links the evidence to a proof session. A verified session proves who recorded whom — not guilt."
        disabled={busy}
      />
    </div>
  );

  return (
    <Modal
      open={open}
      title={created !== null ? 'Evidence added' : 'Add evidence'}
      onClose={close}
      locked={busy}
      size="lg"
      footer={
        created !== null ? (
          <Button variant="primary" onClick={close}>
            Done
          </Button>
        ) : mode === 'file' ? (
          <>
            {fileForm.submitting && abortRef.current !== null ? (
              <Button variant="danger" onClick={() => abortRef.current?.abort()}>
                Cancel upload
              </Button>
            ) : (
              <Button onClick={close} disabled={busy}>
                Cancel
              </Button>
            )}
            <Button variant="primary" type="submit" form="evidence-upload-form" loading={fileForm.submitting} disabled={busy}>
              Upload
            </Button>
          </>
        ) : (
          <>
            <Button onClick={close} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" form="evidence-link-form" loading={linkForm.submitting} disabled={busy}>
              Add link
            </Button>
          </>
        )
      }
    >
      {created !== null ? (
        <div className="stack-sm">
          <p>
            <strong>{created.title}</strong> was stored as evidence <span className="mono text-xs">{created.id}</span> with status{' '}
            <strong>unverified</strong> (not yet reviewed — this does not mean it is fake).
          </p>
          {created.sha256 !== null && (
            <>
              <div className="text-sm">SHA-256 computed by the server while storing the file:</div>
              <CodeBlock value={created.sha256} inline />
              <div className="text-xs text-muted">
                {formatBytes(created.size_bytes)} · {created.mime_type ?? 'unknown type'} · you can compare this hash with the file you keep locally.
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="stack-sm">
          <div className="row" role="radiogroup" aria-label="Evidence kind">
            <Button size="sm" variant={mode === 'file' ? 'primary' : 'secondary'} onClick={() => setMode('file')} aria-pressed={mode === 'file'} disabled={busy}>
              Upload a file
            </Button>
            <Button size="sm" variant={mode === 'link' ? 'primary' : 'secondary'} onClick={() => setMode('link')} aria-pressed={mode === 'link'} disabled={busy}>
              Add an external link
            </Button>
          </div>

          {mode === 'file' ? (
            <form id="evidence-upload-form" className="form" onSubmit={(event) => void fileForm.handleSubmit(event)} noValidate>
              <Input
                label="File"
                type="file"
                accept={ACCEPT}
                onChange={onFileChange}
                error={fileError}
                hint={
                  file === null
                    ? `Video (mp4, webm, mkv), image (png, jpg, webp, gif), text/json logs or zip/gzip archives. Up to ${formatBytes(DEFAULT_EVIDENCE_MAX_BYTES)} by default.`
                    : `${file.name} · ${formatBytes(file.size)} · ${file.type || 'type detected by the server'}`
                }
                required
                disabled={busy}
              />
              <div className="form-grid">
                <Select {...fileForm.field('type')} label="Evidence type" options={FILE_TYPE_OPTIONS} required disabled={busy} />
                <Input {...fileForm.field('title')} label="Title" required maxLength={LIMITS.EVIDENCE_TITLE_MAX} disabled={busy} />
              </div>
              <Textarea
                {...fileForm.field('description')}
                label="Description (optional)"
                rows={3}
                hint={`What the file shows, timestamps of interest, etc. ${lengthHint(fileForm.values.description, LIMITS.EVIDENCE_DESCRIPTION_MAX)}`}
                disabled={busy}
              />
              {associationFields(fileForm)}
              {progress !== null && (
                <div className="stack-sm" aria-live="polite">
                  <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={progress.fraction === null ? undefined : Math.round(progress.fraction * 100)} aria-label="Upload progress">
                    <div className="progress-bar" style={{ width: `${progress.fraction === null ? 100 : Math.round(progress.fraction * 100)}%` }} />
                  </div>
                  <div className="text-xs text-muted">
                    {progress.fraction === null ? `${formatBytes(progress.loaded)} sent…` : `${Math.round(progress.fraction * 100)}% · ${formatBytes(progress.loaded)} of ${formatBytes(progress.total)}`}
                    {progress.fraction === 1 && ' · server is hashing and storing the file…'}
                  </div>
                </div>
              )}
              <FormError error={fileForm.formError} />
            </form>
          ) : (
            <form id="evidence-link-form" className="form" onSubmit={(event) => void linkForm.handleSubmit(event)} noValidate>
              <Input
                {...linkForm.field('url')}
                label="URL"
                type="url"
                placeholder="https://…"
                required
                hint="Only https links. Nothing is downloaded or hashed; reviewers assess the linked content as-is."
                disabled={busy}
              />
              <Input {...linkForm.field('title')} label="Title" required maxLength={LIMITS.EVIDENCE_TITLE_MAX} disabled={busy} />
              <Textarea {...linkForm.field('description')} label="Description (optional)" rows={3} hint={lengthHint(linkForm.values.description, LIMITS.EVIDENCE_DESCRIPTION_MAX)} disabled={busy} />
              {associationFields(linkForm)}
              <FormError error={linkForm.formError} />
            </form>
          )}
        </div>
      )}
    </Modal>
  );
}
