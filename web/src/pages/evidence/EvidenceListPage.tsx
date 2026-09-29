/**
 * Evidence review queue (`GET /evidence`, evidence:view): every evidence item with filters on
 * overall status, type and case. Deep-linked from the dashboard with `?status=unverified`.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';

import { EVIDENCE_STATUSES, EVIDENCE_TYPES, type EvidenceListQuery, type EvidenceView } from '@scpsl-trust/shared';

import { evidenceKeys, listEvidence } from '../../api/evidence';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect, SearchField } from '../../components/FilterBar';
import { CaseLink } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useUrlFilters } from '../../components/useUrlFilters';
import { emptyToUndefined, enumFilter } from '../cases/formHelpers';
import { EvidenceAssessmentBadges, EvidenceOverallBadge } from './EvidenceAssessments';

const FILTER_DEFAULTS = { status: '', type: '', case: '' } as const;

const STATUS_OPTIONS = EVIDENCE_STATUSES.map((value) => ({ value, label: humanizeEnum(value) }));
const TYPE_OPTIONS = EVIDENCE_TYPES.map((value) => ({ value, label: humanizeEnum(value) }));

export function evidencePath(id: string): string {
  return `/evidence/${encodeURIComponent(id)}`;
}

function UploaderCell({ evidence }: { evidence: EvidenceView }) {
  if (evidence.uploader_user !== null) return <span>{evidence.uploader_user.username}</span>;
  if (evidence.uploader_server !== null) return <span>{evidence.uploader_server.name}</span>;
  return <span className="text-faint">—</span>;
}

const columns: readonly Column<EvidenceView>[] = [
  { key: 'type', header: 'Type', render: (row) => <StatusBadge kind="evidenceType" value={row.type} /> },
  { key: 'title', header: 'Title', render: (row) => row.title, wrap: true },
  { key: 'case', header: 'Case', render: (row) => <CaseLink caseNumber={row.case_number} /> },
  { key: 'assessments', header: 'Identity · Authentic · Cheating', render: (row) => <EvidenceAssessmentBadges assessment={row} compact /> },
  { key: 'status', header: 'Overall', render: (row) => <EvidenceOverallBadge status={row.status} />, sortValue: (row) => row.status },
  {
    key: 'chain',
    header: 'Replaced',
    render: (row) => (row.superseded_by_evidence_id !== null ? <span className="text-muted text-xs">superseded</span> : <span className="text-faint">—</span>),
  },
  { key: 'uploaded', header: 'Uploaded', render: (row) => <DateTime value={row.uploaded_at} />, sortValue: (row) => row.uploaded_at },
  { key: 'uploader', header: 'By', render: (row) => <UploaderCell evidence={row} /> },
];

export function EvidenceListPage() {
  const navigate = useNavigate();
  const filters = useUrlFilters(FILTER_DEFAULTS);

  const query: Partial<EvidenceListQuery> = {
    page: filters.page,
    page_size: filters.pageSize,
    status: enumFilter(filters.values.status, EVIDENCE_STATUSES),
    type: enumFilter(filters.values.type, EVIDENCE_TYPES),
    case: emptyToUndefined(filters.values.case)?.toUpperCase(),
  };
  const evidence = useQuery({
    queryKey: evidenceKeys.list(query),
    queryFn: () => listEvidence(query),
    placeholderData: (previous) => previous,
  });

  return (
    <>
      <PageHeader
        title="Evidence queue"
        subtitle="Every item is assessed on three separate questions (identity, authenticity, cheating). Unverified means not yet reviewed — not fake."
      />
      <Card flush>
        <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
          <FilterSelect id="evidence-status" label="Overall status" value={filters.values.status} onChange={(value) => filters.set('status', value)} options={STATUS_OPTIONS} />
          <FilterSelect id="evidence-type" label="Type" value={filters.values.type} onChange={(value) => filters.set('type', value)} options={TYPE_OPTIONS} />
          <SearchField id="evidence-case" label="Case number" placeholder="CASE-2026-000001" value={filters.values.case} onChange={(value) => filters.set('case', value)} />
        </FilterBar>
        <DataTable
          columns={columns}
          rows={evidence.data?.items ?? []}
          rowKey={(row) => row.id}
          onRowClick={(row) => void navigate(evidencePath(row.id))}
          rowClickLabel="Open evidence"
          rowClassName={(row) => (row.superseded_by_evidence_id !== null ? 'text-muted' : undefined)}
          loading={evidence.isPending}
          error={evidence.isError ? <ErrorState error={evidence.error} onRetry={() => void evidence.refetch()} compact /> : undefined}
          emptyState={<EmptyState title="No evidence matches" description={filters.isFiltered ? 'Try clearing a filter.' : 'Evidence is uploaded on case pages.'} />}
          caption="Evidence"
        />
        {evidence.data !== undefined && (
          <Pagination
            page={evidence.data.page}
            pageSize={evidence.data.page_size}
            total={evidence.data.total}
            loaded={evidence.data.items.length}
            onPageChange={filters.setPage}
            onPageSizeChange={filters.setPageSize}
          />
        )}
      </Card>
    </>
  );
}

export default EvidenceListPage;
