/**
 * /admin/security (security:view) — the live Security Monitor.
 *
 * Everything here is READ-ONLY observability over the server-side intrusion-detection layer.
 * Detection and blocking happen entirely on the backend; this panel never reaches a client
 * device. It surfaces:
 *   - a 24h summary strip (GET /admin/security/summary),
 *   - the live security-event log with URL-synced filters and opt-out auto-refresh,
 *   - the transient active blocks with a "Clear block" action (security:manage), and
 *   - the anomaly review queue (heuristic flags for the team to judge — never auto-punishment).
 *
 * Sources are privacy-preserving references only (HMAC network hash / user id / server id);
 * a raw IP, secret or token is never rendered.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  Permission,
  SECURITY_EVENT_KINDS,
  SECURITY_SEVERITIES,
  SECURITY_SOURCE_TYPES,
  SecurityEventKind,
  securitySeverityRank,
  type SecurityBlockView,
  type SecurityEventView,
  type SecuritySummaryResponse,
} from '@scpsl-trust/shared';

import {
  clearSecurityBlock,
  getSecuritySummary,
  listSecurityBlocks,
  listSecurityEvents,
  securityKeys,
} from '../../../api/security';
import { getErrorMessage } from '../../../api/client';
import { useAuth } from '../../../auth/useAuth';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Card, StatCard } from '../../../components/Card';
import { DataTable, type Column } from '../../../components/DataTable';
import { DateTime } from '../../../components/DateTime';
import { EmptyState } from '../../../components/EmptyState';
import { ErrorState } from '../../../components/ErrorState';
import { FilterBar, FilterSelect } from '../../../components/FilterBar';
import { Input, Textarea } from '../../../components/FormField';
import { ConfirmDialog } from '../../../components/Modal';
import { PageHeader } from '../../../components/PageHeader';
import { Pagination } from '../../../components/Pagination';
import { LoadingState } from '../../../components/Spinner';
import { humanizeEnum } from '../../../components/StatusBadge';
import { Tabs, type TabItem } from '../../../components/Tabs';
import { useToast } from '../../../components/Toasts';
import { useUrlFilters } from '../../../components/useUrlFilters';
import { localDateTimeToIso, pickEnum } from '../../servers/lib/forms';
import { SeverityBadge } from './SeverityBadge';

const AUTO_REFRESH_MS = 15_000;

const EVENT_FILTER_DEFAULTS = { kind: '', severity: '', source_type: '', source_ref: '', from: '', to: '' };

const KIND_OPTIONS = SECURITY_EVENT_KINDS.map((kind) => ({ value: kind, label: humanizeEnum(kind) }));
const SEVERITY_OPTIONS = SECURITY_SEVERITIES.map((severity) => ({ value: severity, label: humanizeEnum(severity) }));
const SOURCE_TYPE_OPTIONS = SECURITY_SOURCE_TYPES.map((type) => ({ value: type, label: humanizeEnum(type) }));

type MonitorTab = 'events' | 'blocks' | 'anomalies';

/** A privacy-preserving source cell: type badge + opaque ref (hash/user/server id), never a raw IP. */
function SourceCell({ type, ref }: { type: string; ref: string | null }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <Badge tone="neutral">{humanizeEnum(type)}</Badge>
      {ref === null || ref === '' ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="mono text-xs break-all" title={ref}>
          {ref.length > 20 ? `${ref.slice(0, 20)}…` : ref}
        </span>
      )}
    </span>
  );
}

function ActionBadge({ action }: { action: string }) {
  const tone = action === 'blocked' || action === 'throttled' ? 'danger' : action === 'flagged' ? 'warning' : action === 'unblocked' ? 'success' : 'muted';
  return <Badge tone={tone}>{humanizeEnum(action)}</Badge>;
}

const eventColumns: readonly Column<SecurityEventView>[] = [
  { key: 'time', header: 'When', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
  { key: 'severity', header: 'Severity', render: (row) => <SeverityBadge severity={row.severity} />, sortValue: (row) => securitySeverityRank(row.severity) },
  { key: 'kind', header: 'Kind', render: (row) => <Badge tone="neutral">{humanizeEnum(row.kind)}</Badge>, sortValue: (row) => row.kind },
  { key: 'source', header: 'Source', render: (row) => <SourceCell type={row.source_type} ref={row.source_ref} /> },
  { key: 'action', header: 'Action', render: (row) => <ActionBadge action={row.action_taken} /> },
  { key: 'endpoint', header: 'Endpoint', render: (row) => (row.endpoint === null ? <span className="text-faint">—</span> : <span className="mono text-xs break-all">{row.endpoint}</span>) },
  { key: 'score', header: 'Score', align: 'right', render: (row) => (row.score === null ? <span className="text-faint">—</span> : <span className="mono text-xs">{row.score}</span>), sortValue: (row) => row.score ?? -1 },
  { key: 'request', header: 'Request', render: (row) => (row.request_id === null ? <span className="text-faint">—</span> : <span className="mono text-xs">{row.request_id.slice(0, 8)}…</span>) },
];

// ---------------------------------------------------------------------------
// Summary strip
// ---------------------------------------------------------------------------

function SummaryStrip({ summary }: { summary: SecuritySummaryResponse }) {
  return (
    <div className="stack-sm">
      <div className="stat-grid">
        <StatCard label="Events (last 24h)" value={summary.total_events_last_24h} />
        <StatCard label="Active blocks" value={summary.active_blocks} hint="Transient, server-side" />
        <StatCard label="Anomalies to review" value={summary.anomalies_last_24h} hint="Flags for the team" />
        <StatCard label="Top sources" value={summary.top_sources.length} />
      </div>
      <Card>
        <div className="stack-sm">
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span className="text-muted text-sm">Last 24h by severity:</span>
            {SECURITY_SEVERITIES.map((severity) => (
              <SeverityBadge key={severity} severity={severity} count={summary.events_last_24h[severity]} />
            ))}
          </div>
          <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <Badge tone={summary.detection_enabled ? 'success' : 'muted'} dot>
              Detection {summary.detection_enabled ? 'enabled' : 'disabled'}
            </Badge>
            <Badge tone={summary.anomaly_enabled ? 'success' : 'muted'} dot>
              Anomaly flagging {summary.anomaly_enabled ? 'enabled' : 'disabled'}
            </Badge>
          </div>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Events tab
// ---------------------------------------------------------------------------

function EventsTab({ autoRefresh }: { autoRefresh: boolean }) {
  const filters = useUrlFilters(EVENT_FILTER_DEFAULTS);
  const query = {
    ...filters.query,
    kind: pickEnum(SECURITY_EVENT_KINDS, filters.values.kind),
    severity: pickEnum(SECURITY_SEVERITIES, filters.values.severity),
    source_type: pickEnum(SECURITY_SOURCE_TYPES, filters.values.source_type),
    from: localDateTimeToIso(filters.values.from) ?? undefined,
    to: localDateTimeToIso(filters.values.to) ?? undefined,
  };
  const events = useQuery({
    queryKey: securityKeys.list(query),
    queryFn: () => listSecurityEvents(query),
    placeholderData: (previous) => previous,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });

  return (
    <Card flush>
      <FilterBar onReset={filters.reset} isFiltered={filters.isFiltered}>
        <FilterSelect id="sec-kind" label="Kind" value={filters.values.kind} onChange={(value) => filters.set('kind', value)} options={KIND_OPTIONS} />
        <FilterSelect id="sec-severity" label="Severity" value={filters.values.severity} onChange={(value) => filters.set('severity', value)} options={SEVERITY_OPTIONS} />
        <FilterSelect id="sec-source-type" label="Source type" value={filters.values.source_type} onChange={(value) => filters.set('source_type', value)} options={SOURCE_TYPE_OPTIONS} />
        <Input label="Source ref" id="sec-source-ref" mono placeholder="hash / user / server" value={filters.values.source_ref} onChange={(event) => filters.set('source_ref', event.target.value.trim())} />
        <Input label="From" id="sec-from" type="datetime-local" value={filters.values.from} onChange={(event) => filters.set('from', event.target.value)} />
        <Input label="To" id="sec-to" type="datetime-local" value={filters.values.to} onChange={(event) => filters.set('to', event.target.value)} />
      </FilterBar>
      <DataTable
        columns={eventColumns}
        rows={events.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={events.isPending}
        error={events.isError ? <ErrorState error={events.error} compact onRetry={() => void events.refetch()} /> : undefined}
        emptyState={<EmptyState title="No security events" description={filters.isFiltered ? 'No event matches the filters.' : 'Nothing suspicious has been recorded.'} />}
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
  );
}

// ---------------------------------------------------------------------------
// Blocks tab
// ---------------------------------------------------------------------------

function formatTtl(seconds: number): string {
  if (seconds <= 0) return 'expired';
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function BlocksTab({ autoRefresh }: { autoRefresh: boolean }) {
  const auth = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = auth.hasPermission(Permission.SECURITY_MANAGE);
  const [target, setTarget] = useState<SecurityBlockView | null>(null);
  const [reason, setReason] = useState('');

  const blocks = useQuery({
    queryKey: securityKeys.blocks(),
    queryFn: listSecurityBlocks,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });

  const clear = useMutation({
    mutationFn: (block: SecurityBlockView) => clearSecurityBlock(block.id, { reason: reason.trim() === '' ? null : reason.trim() }),
    onSuccess: (result) => {
      toast.success(result.cleared ? 'Block cleared.' : 'The block had already expired.');
      setTarget(null);
      setReason('');
      void queryClient.invalidateQueries({ queryKey: securityKeys.all });
    },
    onError: (error) => toast.error(getErrorMessage(error)),
  });

  const columns: readonly Column<SecurityBlockView>[] = [
    { key: 'source', header: 'Source', render: (row) => <SourceCell type={row.source_type} ref={row.source_ref} /> },
    { key: 'strikes', header: 'Strikes', align: 'right', render: (row) => <span className="mono text-xs">{row.strikes}</span>, sortValue: (row) => row.strikes },
    { key: 'score', header: 'Score', align: 'right', render: (row) => (row.score === null ? <span className="text-faint">—</span> : <span className="mono text-xs">{row.score}</span>), sortValue: (row) => row.score ?? -1 },
    { key: 'expires', header: 'Expires', render: (row) => <DateTime value={row.expires_at} />, sortValue: (row) => row.expires_at },
    { key: 'ttl', header: 'Remaining', render: (row) => <Badge tone="warning">{formatTtl(row.ttl_seconds)}</Badge>, sortValue: (row) => row.ttl_seconds },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: '',
            render: (row: SecurityBlockView) => (
              <Button size="sm" variant="danger" onClick={() => { setReason(''); setTarget(row); }}>
                Clear block
              </Button>
            ),
          } satisfies Column<SecurityBlockView>,
        ]
      : []),
  ];

  return (
    <Card
      flush
      title="Active blocks"
      actions={<span className="text-muted text-sm">Transient, auto-expiring source blocks held server-side. Human accounts are never auto-disabled.</span>}
    >
      <DataTable
        columns={columns}
        rows={blocks.data?.items ?? []}
        rowKey={(row) => row.id}
        loading={blocks.isPending}
        error={blocks.isError ? <ErrorState error={blocks.error} compact onRetry={() => void blocks.refetch()} /> : undefined}
        emptyState={<EmptyState title="No active blocks" description="No source is currently throttled." />}
      />
      <ConfirmDialog
        open={target !== null}
        title="Clear this block?"
        tone="danger"
        confirmLabel="Clear block"
        loading={clear.isPending}
        onCancel={() => { if (!clear.isPending) { setTarget(null); setReason(''); } }}
        onConfirm={() => { if (target !== null) clear.mutate(target); }}
        message={
          target === null ? null : (
            <span>
              This removes the transient block on <span className="mono text-xs">{humanizeEnum(target.source_type)}</span>{' '}
              <span className="mono text-xs break-all">{target.source_ref}</span>. The source may send requests again immediately. The action is audited.
            </span>
          )
        }
      >
        <Textarea
          label="Reason (optional)"
          id="sec-clear-reason"
          rows={3}
          value={reason}
          maxLength={500}
          placeholder="Why is this block being cleared?"
          onChange={(event) => setReason(event.target.value)}
        />
      </ConfirmDialog>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Anomalies tab (review queue)
// ---------------------------------------------------------------------------

function anomalyReason(event: SecurityEventView): string {
  const metadata = event.metadata as Record<string, unknown>;
  const candidate = metadata.reason ?? metadata.detail ?? metadata.description;
  if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
  return 'Activity deviated from the recent baseline for this source or endpoint.';
}

function AnomaliesTab({ autoRefresh }: { autoRefresh: boolean }) {
  const anomalies = useQuery({
    queryKey: securityKeys.anomalies({ page_size: 50 }),
    queryFn: () => listSecurityEvents({ kind: SecurityEventKind.ANOMALY, page_size: 50 }),
    placeholderData: (previous) => previous,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });

  const items = anomalies.data?.items ?? [];

  return (
    <div className="stack">
      <div className="alert alert-info" role="note">
        <div className="alert-title">For review — not automatic punishment</div>
        <div>
          These are heuristic flags where traffic deviated from its recent baseline. They are surfaced for a human to judge. Nothing here disables or
          penalises an account automatically; only transient request throttling is ever automatic.
        </div>
      </div>
      {anomalies.isPending ? (
        <LoadingState />
      ) : anomalies.isError ? (
        <ErrorState error={anomalies.error} onRetry={() => void anomalies.refetch()} />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No anomalies to review" description="No deviations have been flagged recently." />
        </Card>
      ) : (
        <div className="stack-sm">
          {items.map((event) => (
            <Card key={event.id}>
              <div className="stack-sm">
                <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <SeverityBadge severity={event.severity} />
                  <SourceCell type={event.source_type} ref={event.source_ref} />
                  <span className="text-muted text-sm" style={{ marginLeft: 'auto' }}>
                    <DateTime value={event.created_at} />
                  </span>
                </div>
                <div>{anomalyReason(event)}</div>
                {event.endpoint !== null && <div className="text-muted text-sm">Endpoint: <span className="mono text-xs break-all">{event.endpoint}</span></div>}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function SecurityMonitorPage() {
  const [tab, setTab] = useState<MonitorTab>('events');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const queryClient = useQueryClient();

  const summary = useQuery({
    queryKey: securityKeys.summary(),
    queryFn: getSecuritySummary,
    refetchInterval: autoRefresh ? AUTO_REFRESH_MS : false,
  });

  const tabs: readonly TabItem<MonitorTab>[] = useMemo(
    () => [
      { id: 'events', label: 'Events' },
      { id: 'blocks', label: 'Active blocks', count: summary.data?.active_blocks ?? null },
      { id: 'anomalies', label: 'Anomalies', count: summary.data?.anomalies_last_24h ?? null },
    ],
    [summary.data],
  );

  return (
    <>
      <PageHeader
        title="Security monitor"
        subtitle="Server-side intrusion detection and anomaly review. Detection and blocking happen entirely on the backend; this panel only observes."
        actions={
          <div className="row" style={{ gap: 8 }}>
            <Button
              size="sm"
              variant={autoRefresh ? 'primary' : 'secondary'}
              aria-pressed={autoRefresh}
              onClick={() => setAutoRefresh((value) => !value)}
            >
              {autoRefresh ? 'Auto-refresh: on' : 'Auto-refresh: off'}
            </Button>
            <Button size="sm" onClick={() => void queryClient.invalidateQueries({ queryKey: securityKeys.all })}>
              Refresh now
            </Button>
          </div>
        }
      />
      <div className="stack">
        {summary.isPending ? (
          <LoadingState />
        ) : summary.isError ? (
          <ErrorState error={summary.error} compact onRetry={() => void summary.refetch()} title="Could not load the security summary" />
        ) : (
          <SummaryStrip summary={summary.data} />
        )}

        <Tabs tabs={tabs} value={tab} onChange={setTab} label="Security monitor sections" idPrefix="security" />

        {tab === 'events' && <EventsTab autoRefresh={autoRefresh} />}
        {tab === 'blocks' && <BlocksTab autoRefresh={autoRefresh} />}
        {tab === 'anomalies' && <AnomaliesTab autoRefresh={autoRefresh} />}
      </div>
    </>
  );
}

export default SecurityMonitorPage;
