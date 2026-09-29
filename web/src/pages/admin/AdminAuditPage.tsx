/**
 * /admin/audit (audit:view): filterable, hash-chained event table with a metadata drawer and the
 * "Verify hash chain" action (audit:verify, itself audited as AUDIT_CHAIN_VERIFIED).
 */
import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';

import { ACTOR_TYPES, AUDIT_ACTIONS, AUDIT_TARGET_TYPES, Permission, type AuditEventView, type AuditVerifyResponse } from '@scpsl-trust/shared';

import { auditKeys, listAuditEvents, verifyAuditChain } from '../../api/admin';
import { useAuth } from '../../auth/useAuth';
import { Badge } from '../../components/Badge';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { FilterBar, FilterSelect } from '../../components/FilterBar';
import { Input } from '../../components/FormField';
import { KeyValueList } from '../../components/KeyValueList';
import { PageHeader } from '../../components/PageHeader';
import { Pagination } from '../../components/Pagination';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { useUrlFilters } from '../../components/useUrlFilters';
import { localDateTimeToIso, pickEnum } from '../servers/lib/forms';
import { AuditEventDrawer, AuditTargetCell } from './AuditEventDrawer';

const FILTER_DEFAULTS = { actor_type: '', actor_id: '', action: '', target_type: '', target_id: '', server_id: '', case: '', from: '', to: '' };
const ACTION_OPTIONS = AUDIT_ACTIONS.map((action) => ({ value: action, label: action }));
const ACTOR_TYPE_OPTIONS = ACTOR_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }));
const TARGET_TYPE_OPTIONS = AUDIT_TARGET_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }));

function VerifyResult({ result }: { result: AuditVerifyResponse }) {
  return (
    <div className={result.valid ? 'alert alert-success' : 'alert alert-danger'} role="status">
      <div className="alert-title">{result.valid ? 'Hash chain intact' : 'Hash chain broken'}</div>
      <KeyValueList
        items={[
          { label: 'Checked events', value: result.checked_events },
          { label: 'Last seq', value: result.last_seq },
          { label: 'Last hash', value: result.last_hash === null ? null : <span className="mono text-xs break-all">{result.last_hash}</span> },
          { label: 'First broken seq', value: result.first_broken_seq },
          { label: 'Failure', value: result.failure === null ? null : <StatusBadge kind="auditVerifyFailure" value={result.failure} /> },
          { label: 'Verified at', value: <DateTime value={result.verified_at} /> },
        ]}
      />
    </div>
  );
}

const columns: readonly Column<AuditEventView>[] = [
  { key: 'seq', header: '#', align: 'right', render: (row) => <span className="mono text-xs">{row.seq}</span>, sortValue: (row) => row.seq },
  { key: 'time', header: 'When', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
  { key: 'action', header: 'Event', render: (row) => <StatusBadge kind="auditAction" value={row.action} />, sortValue: (row) => row.action },
  {
    key: 'actor',
    header: 'Actor',
    render: (row) => (
      <span className="row" style={{ gap: 6 }}>
        <StatusBadge kind="actorType" value={row.actor_type} />
        {row.actor_label !== null ? <span>{row.actor_label}</span> : row.actor_id !== null ? <span className="mono text-xs">{row.actor_id}</span> : null}
      </span>
    ),
  },
  { key: 'target', header: 'Target', render: (row) => <AuditTargetCell event={row} /> },
  {
    key: 'metadata',
    header: 'Metadata',
    render: (row) => {
      const keys = Object.keys(row.metadata);
      return keys.length === 0 ? <span className="text-faint">—</span> : <Badge tone="muted">{keys.length} field{keys.length === 1 ? '' : 's'}</Badge>;
    },
  },
  { key: 'request', header: 'Request', render: (row) => (row.request_id === null ? <span className="text-faint">—</span> : <span className="mono text-xs">{row.request_id.slice(0, 8)}…</span>) },
];

export function AdminAuditPage() {
  const auth = useAuth();
  const filters = useUrlFilters(FILTER_DEFAULTS);
  const [selected, setSelected] = useState<AuditEventView | null>(null);
  const [verifyResult, setVerifyResult] = useState<AuditVerifyResponse | null>(null);
  const canVerify = auth.hasPermission(Permission.AUDIT_VERIFY);

  const query = {
    ...filters.query,
    actor_type: pickEnum(ACTOR_TYPES, filters.values.actor_type),
    action: pickEnum(AUDIT_ACTIONS, filters.values.action),
    from: localDateTimeToIso(filters.values.from) ?? undefined,
    to: localDateTimeToIso(filters.values.to) ?? undefined,
  };
  const events = useQuery({ queryKey: auditKeys.list(query), queryFn: () => listAuditEvents(query), placeholderData: (previous) => previous });

  const verify = useMutation({ mutationFn: verifyAuditChain, onSuccess: (result) => setVerifyResult(result) });

  return (
    <>
      <PageHeader
        title="Audit log"
        subtitle="Append-only, hash-chained record of every important action (R8). Events are never edited or deleted."
        actions={
          canVerify ? (
            <Button variant="primary" onClick={() => verify.mutate()} loading={verify.isPending}>
              Verify hash chain
            </Button>
          ) : undefined
        }
      />
      <div className="stack">
        {verify.isError && <ErrorState error={verify.error} compact title="Verification failed" />}
        {verifyResult !== null && <VerifyResult result={verifyResult} />}

        <Card flush>
          <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
            <FilterSelect id="audit-action" label="Action" value={filters.values.action} onChange={(value) => filters.set('action', value)} options={ACTION_OPTIONS} />
            <FilterSelect id="audit-actor-type" label="Actor type" value={filters.values.actor_type} onChange={(value) => filters.set('actor_type', value)} options={ACTOR_TYPE_OPTIONS} />
            <Input label="Actor id" id="audit-actor-id" mono placeholder="user uuid / srv_…" value={filters.values.actor_id} onChange={(event) => filters.set('actor_id', event.target.value.trim())} />
            <FilterSelect id="audit-target-type" label="Target type" value={filters.values.target_type} onChange={(value) => filters.set('target_type', value)} options={TARGET_TYPE_OPTIONS} />
            <Input label="Target id" id="audit-target-id" mono placeholder="id" value={filters.values.target_id} onChange={(event) => filters.set('target_id', event.target.value.trim())} />
            <Input label="Server id" id="audit-server" mono placeholder="srv_…" value={filters.values.server_id} onChange={(event) => filters.set('server_id', event.target.value.trim())} />
            <Input label="Case" id="audit-case" mono placeholder="CASE-2026-000001" value={filters.values.case} onChange={(event) => filters.set('case', event.target.value.trim().toUpperCase())} />
            <Input label="From" id="audit-from" type="datetime-local" value={filters.values.from} onChange={(event) => filters.set('from', event.target.value)} />
            <Input label="To" id="audit-to" type="datetime-local" value={filters.values.to} onChange={(event) => filters.set('to', event.target.value)} />
          </FilterBar>
          <DataTable
            columns={columns}
            rows={events.data?.items ?? []}
            rowKey={(row) => row.event_id}
            loading={events.isPending}
            error={events.isError ? <ErrorState error={events.error} compact onRetry={() => void events.refetch()} /> : undefined}
            onRowClick={(row) => setSelected(row)}
            rowClickLabel="Show event details"
            emptyState={<EmptyState title="No events" description={filters.isFiltered ? 'No event matches the filters.' : undefined} />}
          />
          {events.data !== undefined && (
            <Pagination
              page={events.data.page}
              pageSize={events.data.page_size}
              total={events.data.total}
              loaded={events.data.items.length}
              onPageChange={filters.setPage}
              onPageSizeChange={filters.setPageSize}
            />
          )}
        </Card>
      </div>
      <AuditEventDrawer event={selected} onClose={() => setSelected(null)} />
    </>
  );
}

export default AdminAuditPage;
