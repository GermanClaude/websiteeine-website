/**
 * Evidence detail (`GET /evidence/{id}`): metadata incl. SHA-256, ticketed preview/download,
 * integrity re-hash (reviewer+), the three-question review form, review history and the
 * supersede action. Access is enforced by the backend (evidence:view, uploader, uploader server).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';

import { Permission, type EvidenceDetail, type EvidenceIntegrity, type EvidenceReviewView, type EvidenceTicketResponse } from '@scpsl-trust/shared';

import { getErrorMessage } from '../../api/client';
import { createEvidenceTicket, evidenceContentUrl, evidenceKeys, evidencePreviewKind, getEvidence } from '../../api/evidence';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { CodeBlock } from '../../components/CodeBlock';
import { DateTime } from '../../components/DateTime';
import { ErrorState } from '../../components/ErrorState';
import { KeyValueList } from '../../components/KeyValueList';
import { CaseLink } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';
import { Timeline, type TimelineEntry } from '../../components/Timeline';
import { useToast } from '../../components/Toasts';
import { formatBytes } from '../../lib/format';
import { ASSESSMENT_QUESTIONS, EVIDENCE_STATUS_HELP, EvidenceAssessmentBadges, EvidenceOverallBadge } from './EvidenceAssessments';
import { EvidenceReviewForm } from './EvidenceReviewForm';
import { EvidenceSupersedeModal } from './EvidenceSupersedeModal';

function evidencePath(id: string): string {
  return `/evidence/${encodeURIComponent(id)}`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

// ---------------------------------------------------------------------------
// Content: ticketed preview + download
// ---------------------------------------------------------------------------

interface LoadedContent {
  url: string;
  expiresAt: string;
}

function ContentCard({ evidence }: { evidence: EvidenceDetail }) {
  const toast = useToast();
  const [preview, setPreview] = useState<LoadedContent | null>(null);
  const previewKind = evidencePreviewKind(evidence.mime_type);

  const ticket = useMutation({ mutationFn: () => createEvidenceTicket(evidence.id) });

  // Tickets are short-lived (60 s); drop the preview URL once it can no longer be (re)loaded.
  useEffect(() => {
    if (preview === null) return;
    const remaining = Date.parse(preview.expiresAt) - Date.now();
    if (!Number.isFinite(remaining)) return;
    const timer = setTimeout(() => setPreview(null), Math.max(0, remaining) + 5 * 60_000);
    return () => clearTimeout(timer);
  }, [preview]);

  const toContent = (response: EvidenceTicketResponse): LoadedContent => ({ url: evidenceContentUrl(evidence.id, response), expiresAt: response.expires_at });

  const loadPreview = async () => {
    try {
      setPreview(toContent(await ticket.mutateAsync()));
    } catch (error) {
      toast.error(getErrorMessage(error), 'Could not load the preview');
    }
  };

  const download = async () => {
    try {
      const content = toContent(await ticket.mutateAsync());
      const anchor = document.createElement('a');
      anchor.href = content.url;
      anchor.download = evidence.original_filename ?? evidence.title;
      anchor.rel = 'noopener';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch (error) {
      toast.error(getErrorMessage(error), 'Could not start the download');
    }
  };

  if (evidence.type === 'link') {
    return (
      <Card title="Content">
        <p className="text-sm">
          External link (nothing is stored or hashed):{' '}
          {evidence.external_url !== null ? (
            <a href={evidence.external_url} target="_blank" rel="noopener noreferrer" className="break-all">
              {evidence.external_url}
            </a>
          ) : (
            <span className="text-faint">—</span>
          )}
        </p>
        <p className="text-xs text-muted">Opens in a new tab. Reviewers assess the linked content as-is; it may change or disappear at any time.</p>
      </Card>
    );
  }

  return (
    <Card
      title="Content"
      actions={
        <>
          {previewKind !== null && preview === null && (
            <Button size="sm" onClick={() => void loadPreview()} loading={ticket.isPending}>
              Load preview
            </Button>
          )}
          <Button size="sm" variant="primary" onClick={() => void download()} loading={ticket.isPending}>
            Download
          </Button>
        </>
      }
    >
      <div className="stack-sm">
        <p className="text-xs text-muted" style={{ margin: 0 }}>
          Every preview or download requests a 60-second access ticket and is recorded in the audit log (EVIDENCE_ACCESSED). Files are served as
          attachments with a sandboxed content policy.
        </p>
        {preview !== null && previewKind === 'image' && (
          <img src={preview.url} alt={evidence.title} style={{ maxWidth: '100%', maxHeight: 520, borderRadius: 'var(--radius-md, 6px)' }} />
        )}
        {preview !== null && previewKind === 'video' && (
          <video src={preview.url} controls preload="metadata" style={{ maxWidth: '100%', maxHeight: 520, background: '#000' }}>
            Your browser cannot play this video. Use the download button instead.
          </video>
        )}
        {preview !== null && (
          <div className="row text-xs text-muted">
            <span>Preview loaded with a ticket valid until <DateTime value={preview.expiresAt} format="time" />.</span>
            <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
              Hide preview
            </Button>
          </div>
        )}
        {previewKind === null && <p className="text-sm text-muted">No inline preview for {evidence.mime_type ?? 'this file type'}; download the file to inspect it.</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Integrity (reviewer+)
// ---------------------------------------------------------------------------

function IntegrityPanel({ evidence, canVerify }: { evidence: EvidenceDetail; canVerify: boolean }) {
  const [result, setResult] = useState<EvidenceIntegrity | null>(evidence.integrity);
  const verify = useMutation({
    mutationFn: async () => (await getEvidence(evidence.id, { verify: true })).integrity,
    onSuccess: (integrity) => setResult(integrity),
  });

  if (evidence.sha256 === null) return null;
  return (
    <div className="stack-sm">
      <div className="row-between">
        <span className="text-sm text-muted">Integrity check re-hashes the stored object and compares it with the SHA-256 recorded at upload.</span>
        {canVerify && (
          <Button size="sm" onClick={() => verify.mutate()} loading={verify.isPending}>
            Verify integrity
          </Button>
        )}
      </div>
      {verify.isError && <ErrorState error={verify.error} compact />}
      {result !== null && (
        <div className={result.verified ? 'alert alert-success text-sm' : 'alert alert-danger text-sm'} role="status">
          <div className="alert-title">{result.verified ? 'Stored file matches the recorded hash' : 'Hash mismatch — the stored object differs from the recorded hash'}</div>
          <div>
            Checked <DateTime value={result.checked_at} />
            {result.computed_sha256 !== null && (
              <>
                {' · computed '}
                <span className="mono break-all">{result.computed_sha256}</span>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Review history
// ---------------------------------------------------------------------------

function reviewEntries(reviews: readonly EvidenceReviewView[]): TimelineEntry[] {
  return [...reviews]
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
    .map((review) => ({
      id: review.id,
      at: review.created_at,
      title: (
        <span className="row" style={{ gap: 6 }}>
          <span>Overall</span>
          <EvidenceOverallBadge status={review.status} />
        </span>
      ),
      description: (
        <span className="stack-sm" style={{ gap: 4 }}>
          <EvidenceAssessmentBadges assessment={review} />
          <span style={{ whiteSpace: 'pre-wrap' }}>{review.comment}</span>
        </span>
      ),
      meta: review.reviewer.pseudonym,
      tone: review.status === 'verified' ? 'success' : review.status === 'rejected' ? 'danger' : review.status === 'inconclusive' ? 'warning' : 'neutral',
    }));
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function EvidenceDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const auth = useAuth();
  const [supersedeOpen, setSupersedeOpen] = useState(false);

  const evidence = useQuery({ queryKey: evidenceKeys.detail(id), queryFn: () => getEvidence(id), enabled: id !== '' });

  const breadcrumbs = [{ label: 'Evidence queue', to: '/evidence' }, { label: id === '' ? 'Evidence' : shortId(id) }];

  if (evidence.isPending) {
    return (
      <>
        <PageHeader title="Evidence" breadcrumbs={breadcrumbs} />
        <LoadingState />
      </>
    );
  }
  if (evidence.isError) {
    return (
      <>
        <PageHeader title="Evidence" breadcrumbs={breadcrumbs} />
        <ErrorState error={evidence.error} onRetry={() => void evidence.refetch()} />
      </>
    );
  }

  const data = evidence.data;
  const canReview = auth.hasPermission(Permission.EVIDENCE_REVIEW);
  const canVerify = auth.hasPermission(Permission.EVIDENCE_VIEW);
  const isUploader = auth.user !== null && data.uploader_user?.id === auth.user.id;
  const canSupersede = data.type !== 'link' && data.superseded_by_evidence_id === null && (auth.hasPermission(Permission.EVIDENCE_UPLOAD) || isUploader || auth.hasServerMembership);

  return (
    <>
      <PageHeader
        title={data.title}
        documentTitle={`Evidence ${shortId(data.id)}`}
        breadcrumbs={[{ label: 'Evidence queue', to: '/evidence' }, { label: shortId(data.id) }]}
        badges={
          <span className="row" style={{ marginLeft: 8, display: 'inline-flex' }}>
            <StatusBadge kind="evidenceType" value={data.type} />
            <EvidenceOverallBadge status={data.status} />
            {data.superseded_by_evidence_id !== null && <Badge tone="warning">superseded</Badge>}
          </span>
        }
        subtitle={
          <span className="row">
            <span>
              Case <CaseLink caseNumber={data.case_number} />
            </span>
            <span className="text-muted">
              · uploaded <DateTime value={data.uploaded_at} />
            </span>
          </span>
        }
        actions={
          canSupersede ? (
            <Button onClick={() => setSupersedeOpen(true)}>Replace file</Button>
          ) : undefined
        }
      />

      <div className="stack">
        {data.superseded_by_evidence_id !== null && (
          <div className="alert alert-warning" role="status">
            This item was superseded by{' '}
            <Link to={evidencePath(data.superseded_by_evidence_id)} className="mono">
              {shortId(data.superseded_by_evidence_id)}
            </Link>
            . It is kept for the record; the replacement is what supports the case.
          </div>
        )}

        <div className="grid-2">
          <Card title="Metadata">
            <KeyValueList
              items={[
                { label: 'Evidence id', value: <span className="mono text-xs break-all">{data.id}</span> },
                { label: 'Case', value: <CaseLink caseNumber={data.case_number} /> },
                { label: 'Type', value: <StatusBadge kind="evidenceType" value={data.type} /> },
                { label: 'Title', value: data.title },
                { label: 'Description', value: data.description === null ? null : <span style={{ whiteSpace: 'pre-wrap' }}>{data.description}</span> },
                { label: 'SHA-256', value: data.sha256 === null ? <span className="text-faint">none (link evidence)</span> : <CodeBlock value={data.sha256} inline /> },
                { label: 'Size', value: data.size_bytes === null ? null : formatBytes(data.size_bytes) },
                { label: 'MIME type', value: data.mime_type === null ? null : <span className="mono">{data.mime_type}</span> },
                { label: 'Original file name', value: data.original_filename },
                { label: 'Uploaded', value: <DateTime value={data.uploaded_at} /> },
                {
                  label: 'Uploader',
                  value:
                    data.uploader_user !== null ? (
                      <span>{data.uploader_user.username}</span>
                    ) : data.uploader_server !== null ? (
                      <span>
                        server {data.uploader_server.name} <span className="mono text-xs text-muted">{data.uploader_server.server_id}</span>
                      </span>
                    ) : null,
                },
                {
                  label: 'Related report',
                  value: data.report_id === null ? null : (
                    <Link to={`/reports/${encodeURIComponent(data.report_id)}`} className="mono text-xs">
                      {data.report_id}
                    </Link>
                  ),
                },
                {
                  label: 'Overwatch session',
                  value: data.overwatch_session_id === null ? null : (
                    <span className="stack-sm" style={{ gap: 2 }}>
                      <Link to={`/overwatch/${encodeURIComponent(data.overwatch_session_id)}`} className="mono text-xs">
                        {data.overwatch_session_id}
                      </Link>
                      <span className="text-xs text-muted">A verified session proves who recorded whom (identity) — it never proves cheating.</span>
                    </span>
                  ),
                },
                {
                  label: 'Replaces',
                  value: data.supersedes_evidence_id === null ? null : (
                    <Link to={evidencePath(data.supersedes_evidence_id)} className="mono text-xs">
                      {data.supersedes_evidence_id}
                    </Link>
                  ),
                },
                {
                  label: 'Replaced by',
                  value: data.superseded_by_evidence_id === null ? null : (
                    <Link to={evidencePath(data.superseded_by_evidence_id)} className="mono text-xs">
                      {data.superseded_by_evidence_id}
                    </Link>
                  ),
                },
              ]}
            />
          </Card>

          <div className="stack">
            <Card title="Assessments">
              <KeyValueList
                items={[
                  ...ASSESSMENT_QUESTIONS.map((item) => ({
                    key: item.key,
                    label: item.short,
                    value: (
                      <span className="stack-sm" style={{ gap: 2 }}>
                        <StatusBadge kind="evidenceStatus" value={data[item.key]} dot />
                        <span className="text-xs text-muted">
                          {item.question} {EVIDENCE_STATUS_HELP[data[item.key]]}
                        </span>
                      </span>
                    ),
                  })),
                  {
                    key: 'overall',
                    label: 'Overall',
                    value: (
                      <span className="stack-sm" style={{ gap: 2 }}>
                        <EvidenceOverallBadge status={data.status} />
                        <span className="text-xs text-muted">{EVIDENCE_STATUS_HELP[data.status]}</span>
                      </span>
                    ),
                  },
                ]}
              />
              <hr className="divider" />
              <p className="text-xs text-muted" style={{ margin: 0 }}>
                Identity, authenticity and cheating are assessed separately (R2). Reviewing evidence never changes the case verdict; a reviewer sets
                that on the case page.
              </p>
            </Card>
            <Card title="Integrity">
              {data.sha256 === null ? <p className="text-sm text-muted">Link evidence has no stored object to verify.</p> : <IntegrityPanel evidence={data} canVerify={canVerify} />}
            </Card>
          </div>
        </div>

        <ContentCard evidence={data} />

        {canReview && (
          <Card title="Review this evidence">
            <EvidenceReviewForm evidence={data} />
          </Card>
        )}

        <Card title={`Review history (${data.reviews.length})`}>
          <Timeline entries={reviewEntries(data.reviews)} emptyTitle="Not reviewed yet — this does not mean the evidence is fake" />
        </Card>
      </div>

      {canSupersede && <EvidenceSupersedeModal open={supersedeOpen} evidence={data} onClose={() => setSupersedeOpen(false)} />}
    </>
  );
}

export default EvidenceDetailPage;
