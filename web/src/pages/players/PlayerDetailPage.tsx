/**
 * Player page (brief §24, `GET /players/{userId}`): the public view for everyone with a session,
 * plus the staff sections (signals, possible links, sightings, bypasses) when the backend returns
 * the staff view. Never shows raw IPs, network hashes or reviewer identities.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';

import {
  isCanonicalUserId,
  type BypassView,
  type PlayerLinkView,
  type PlayerPublicCase,
  type PlayerSignalView,
  type PlayerSightingView,
  type PlayerStaffCase,
  type PlayerStaffView,
  type PlayerViewResponse,
} from '@scpsl-trust/shared';

import { ApiError } from '../../api/client';
import { getPlayer, playerKeys } from '../../api/players';
import { Badge } from '../../components/Badge';
import { LinkButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime, RelativeTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ErrorState } from '../../components/ErrorState';
import { KeyValueList } from '../../components/KeyValueList';
import { CaseLink, ServerLink, UserIdLink, casePath } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';
import { ReporterCell, reportPath } from '../cases/CaseSections';

// ---------------------------------------------------------------------------
// Cases (public + staff)
// ---------------------------------------------------------------------------

const publicCaseColumns: readonly Column<PlayerPublicCase>[] = [
  { key: 'case', header: 'Case', render: (row) => <CaseLink caseNumber={row.case_number} /> },
  { key: 'verdict', header: 'Verdict', render: (row) => <StatusBadge kind="verdict" value={row.verdict} dot />, sortValue: (row) => row.verdict },
  { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="caseStatus" value={row.status} /> },
  { key: 'summary', header: 'Public summary', render: (row) => row.public_summary ?? <span className="text-faint">—</span>, wrap: true },
  { key: 'reports', header: 'Reports', align: 'right', render: (row) => row.report_count },
  { key: 'confirmed', header: 'Confirmed by', align: 'right', render: (row) => `${row.confirmed_servers} server${row.confirmed_servers === 1 ? '' : 's'}` },
  { key: 'appeal', header: 'Appeal', render: (row) => (row.appeal_status === null ? <span className="text-faint">—</span> : <StatusBadge kind="appealStatus" value={row.appeal_status} />) },
  { key: 'updated', header: 'Updated', render: (row) => <RelativeTime value={row.updated_at} />, sortValue: (row) => row.updated_at },
];

const staffCaseColumns: readonly Column<PlayerStaffCase>[] = [
  ...publicCaseColumns.slice(0, 3),
  { key: 'reason', header: 'Reason (internal)', render: (row) => row.reason, wrap: true },
  {
    key: 'reports',
    header: 'Reports',
    align: 'right',
    render: (row) => (
      <span>
        {row.report_count}
        {row.open_report_count > 0 && <span className="text-muted text-xs"> ({row.open_report_count} open)</span>}
      </span>
    ),
  },
  { key: 'evidence', header: 'Evidence', align: 'right', render: (row) => row.evidence_count },
  ...publicCaseColumns.slice(5),
];

// ---------------------------------------------------------------------------
// Staff sections
// ---------------------------------------------------------------------------

const signalColumns: readonly Column<PlayerSignalView>[] = [
  { key: 'signal', header: 'Signal', render: (row) => <StatusBadge kind="playerSignalType" value={row.signal} dot /> },
  {
    key: 'confidence',
    header: 'Confidence',
    render: (row) =>
      row.confidence === null ? (
        <span className="text-faint">—</span>
      ) : row.signal === 'vpn_detected' ? (
        <StatusBadge kind="vpnConfidence" value={row.confidence} />
      ) : (
        <StatusBadge kind="altConfidence" value={row.confidence} />
      ),
  },
  { key: 'source', header: 'Source', render: (row) => <span className="mono text-xs">{row.source}</span> },
  {
    key: 'details',
    header: 'Details',
    render: (row) =>
      row.detail_codes.length === 0 ? (
        <span className="text-faint">—</span>
      ) : (
        <span className="row" style={{ gap: 4 }}>
          {row.detail_codes.map((code) => (
            <Badge key={code} tone="neutral">
              {humanizeEnum(code)}
            </Badge>
          ))}
        </span>
      ),
    wrap: true,
  },
  { key: 'server', header: 'Server', render: (row) => (row.server === null ? <span className="text-faint">—</span> : <ServerLink serverId={row.server.server_id} name={row.server.name} />) },
  { key: 'created', header: 'Recorded', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
  { key: 'expires', header: 'Expires', render: (row) => <DateTime value={row.expires_at} empty="never" /> },
];

const linkColumns: readonly Column<PlayerLinkView>[] = [
  { key: 'player', header: 'Possibly linked player', render: (row) => <UserIdLink userId={row.linked_player.user_id} displayName={row.linked_player.display_name} /> },
  { key: 'signal', header: 'Signal', render: (row) => <StatusBadge kind="altSignal" value={row.signal} /> },
  { key: 'occurrences', header: 'Occurrences', align: 'right', render: (row) => row.occurrences, sortValue: (row) => row.occurrences },
  { key: 'first', header: 'First', render: (row) => <DateTime value={row.first_detected_at} /> },
  { key: 'last', header: 'Last', render: (row) => <DateTime value={row.last_detected_at} />, sortValue: (row) => row.last_detected_at },
  {
    key: 'cases',
    header: 'Confirmed cases of that player',
    render: (row) =>
      row.linked_confirmed_cases.length === 0 ? (
        <span className="text-faint">none</span>
      ) : (
        <span className="row" style={{ gap: 4 }}>
          {row.linked_confirmed_cases.map((caseNumber) => (
            <CaseLink key={caseNumber} caseNumber={caseNumber} />
          ))}
        </span>
      ),
    wrap: true,
  },
];

const sightingColumns: readonly Column<PlayerSightingView>[] = [
  { key: 'server', header: 'Server', render: (row) => <ServerLink serverId={row.server.server_id} name={row.server.name} /> },
  { key: 'joins', header: 'Joins', align: 'right', render: (row) => row.join_count, sortValue: (row) => row.join_count },
  { key: 'first', header: 'First seen', render: (row) => <DateTime value={row.first_seen_at} />, sortValue: (row) => row.first_seen_at },
  { key: 'last', header: 'Last seen', render: (row) => <DateTime value={row.last_seen_at} />, sortValue: (row) => row.last_seen_at },
];

const bypassColumns: readonly Column<BypassView>[] = [
  { key: 'type', header: 'Type', render: (row) => <StatusBadge kind="bypassType" value={row.type} /> },
  { key: 'scope', header: 'Scope', render: (row) => <StatusBadge kind="bypassScope" value={row.scope} /> },
  { key: 'server', header: 'Server', render: (row) => (row.server === null ? <span className="text-muted">all servers</span> : <ServerLink serverId={row.server.server_id} name={row.server.name} />) },
  { key: 'reason', header: 'Reason', render: (row) => row.reason, wrap: true },
  { key: 'granted', header: 'Granted by', render: (row) => row.granted_by.username },
  { key: 'expires', header: 'Expires', render: (row) => <DateTime value={row.expires_at} empty="never" /> },
  {
    key: 'state',
    header: 'State',
    render: (row) =>
      row.active ? (
        <Badge tone="success" dot>
          active
        </Badge>
      ) : row.revoked_at !== null ? (
        <Badge tone="muted" title={row.revoke_reason ?? undefined}>
          revoked
        </Badge>
      ) : (
        <Badge tone="muted">expired</Badge>
      ),
  },
];

function StaffSections({ data }: { data: PlayerStaffView }) {
  const navigate = useNavigate();
  const player = data.player;
  return (
    <>
      <div className="grid-2">
        <Card title="Activity">
          <KeyValueList
            items={[
              { label: 'First seen', value: <DateTime value={player.first_seen_at} /> },
              { label: 'Last seen', value: <DateTime value={player.last_seen_at} /> },
              {
                label: 'Account age',
                value: (
                  <span className="stack-sm" style={{ gap: 2 }}>
                    <span className="row" style={{ gap: 6 }}>
                      {player.account_age_days === null ? <span className="text-faint">unknown</span> : `${player.account_age_days} day${player.account_age_days === 1 ? '' : 's'}`}
                      <StatusBadge kind="accountAgeSource" value={player.account_age_source} />
                    </span>
                    <span className="text-xs text-muted">
                      {player.account_created_at !== null && (
                        <>
                          created <DateTime value={player.account_created_at} format="date" /> ·{' '}
                        </>
                      )}
                      {player.account_age_checked_at === null ? 'not checked yet' : <>checked <RelativeTime value={player.account_age_checked_at} /></>}
                      {' · a young account is not cheating (R4)'}
                    </span>
                  </span>
                ),
              },
              {
                label: 'Linked web account',
                value: data.linked_user === null ? <span className="text-faint">none</span> : data.linked_user.username,
              },
            ]}
          />
        </Card>
        <Card title="Servers seen">
          <DataTable columns={sightingColumns} rows={data.sightings} rowKey={(row) => row.server.server_id} emptyState={<EmptyState title="No sightings recorded" />} caption="Servers seen" />
        </Card>
      </div>

      <Card title={`Signals (${data.signals.length})`} flush>
        <p className="text-xs text-muted" style={{ padding: 'var(--sp-3) var(--sp-4) 0' }}>
          Signals feed server policies only. A VPN is not cheating (R3), a young account is not cheating (R4); none of them touches a verdict.
        </p>
        <DataTable columns={signalColumns} rows={data.signals} rowKey={(row) => row.id} emptyState={<EmptyState title="No signals" />} caption="Signals" />
      </Card>

      <Card title={`Possible linked accounts (${data.links.length})`} flush>
        <div className="alert alert-warning text-sm" style={{ margin: 'var(--sp-3) var(--sp-4) 0' }} role="note">
          <strong>Possible</strong> links only — shared network signals are <strong>not proof</strong> that two identities belong to the same person (R5). Shared
          IP ≠ same person; IP-only evidence is capped at medium confidence.
        </div>
        <DataTable
          columns={linkColumns}
          rows={data.links}
          rowKey={(row) => `${row.linked_player.user_id}:${row.signal}`}
          onRowClick={(row) => void navigate(`/players/${encodeURIComponent(row.linked_player.user_id)}`)}
          rowClickLabel="Open linked player"
          emptyState={<EmptyState title="No linked accounts detected" />}
          caption="Possible linked accounts"
        />
      </Card>

      <Card title={`Recent reports (${data.recent_reports.length})`} flush>
        <DataTable
          columns={[
            { key: 'created', header: 'Submitted', render: (row) => <DateTime value={row.created_at} /> },
            { key: 'case', header: 'Case', render: (row) => <CaseLink caseNumber={row.case_number} /> },
            { key: 'reporter', header: 'Reporter', render: (row) => <ReporterCell report={row} /> },
            { key: 'reason', header: 'Reason', render: (row) => row.reason, wrap: true },
            { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="reportStatus" value={row.status} dot /> },
          ]}
          rows={data.recent_reports}
          rowKey={(row) => row.id}
          onRowClick={(row) => void navigate(reportPath(row.id))}
          rowClickLabel="Open report"
          emptyState={<EmptyState title="No reports" />}
          caption="Recent reports"
        />
      </Card>

      <Card title={`Bypasses (${data.bypasses.length})`} flush>
        <DataTable columns={bypassColumns} rows={data.bypasses} rowKey={(row) => row.id} emptyState={<EmptyState title="No bypasses" />} caption="Bypasses" />
      </Card>
    </>
  );
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

function IdentityCard({ data }: { data: PlayerViewResponse }) {
  const player = data.player;
  return (
    <Card title="Identity">
      <KeyValueList
        items={[
          { label: 'User id', value: <span className="mono break-all">{player.user_id}</span> },
          { label: 'Identity type', value: <StatusBadge kind="playerIdType" value={player.type} /> },
          { label: 'Display name', value: player.display_name },
          { label: 'First seen', value: <DateTime value={player.first_seen_at} /> },
          {
            label: 'Global status',
            value: (
              <span className="row" style={{ gap: 6 }}>
                <StatusBadge kind="globalStatus" value={data.global_status} dot />
                {data.case_id !== null && (
                  <span className="text-xs text-muted">
                    from <CaseLink caseNumber={data.case_id} />
                  </span>
                )}
              </span>
            ),
          },
          { label: 'Reports (not rejected)', value: data.reports },
          { label: 'Server confirmations', value: data.confirmed_servers },
        ]}
      />
      <hr className="divider" />
      <p className="text-xs text-muted" style={{ margin: 0 }}>
        The global status is information for servers; each server decides locally what to do with it. Raw IP addresses are never stored or shown.
      </p>
    </Card>
  );
}

export function PlayerDetailPage() {
  const params = useParams<{ userId: string }>();
  const userId = decodeURIComponent(params.userId ?? '');
  const valid = isCanonicalUserId(userId);
  const player = useQuery({ queryKey: playerKeys.detail(userId), queryFn: () => getPlayer(userId), enabled: valid });
  const breadcrumbs = [{ label: 'Players', to: '/players' }, { label: userId }];

  if (!valid) {
    return (
      <>
        <PageHeader title="Player" breadcrumbs={breadcrumbs} />
        <ErrorState error={new ApiError({ status: 404, code: 'NOT_FOUND', message: `"${userId}" is not a valid player user id (expected <id>@steam|discord|northwood).` })} />
      </>
    );
  }
  if (player.isPending) {
    return (
      <>
        <PageHeader title={userId} breadcrumbs={breadcrumbs} />
        <LoadingState />
      </>
    );
  }
  if (player.isError) {
    return (
      <>
        <PageHeader title={userId} breadcrumbs={breadcrumbs} />
        <ErrorState error={player.error} onRetry={() => void player.refetch()} />
      </>
    );
  }

  const data = player.data;
  const title = data.player.display_name !== null && data.player.display_name !== '' ? data.player.display_name : userId;

  return (
    <>
      <PageHeader
        title={title}
        documentTitle={`Player ${userId}`}
        breadcrumbs={breadcrumbs}
        badges={
          <span className="row" style={{ marginLeft: 8, display: 'inline-flex' }}>
            <StatusBadge kind="globalStatus" value={data.global_status} dot />
            <Badge tone={data.view === 'staff' ? 'accent' : 'muted'}>{data.view === 'staff' ? 'staff view' : 'public view'}</Badge>
          </span>
        }
        subtitle={<span className="mono text-muted">{userId}</span>}
        actions={
          data.case_id !== null ? (
            <LinkButton to={casePath(data.case_id)} variant="secondary">
              Open current case
            </LinkButton>
          ) : undefined
        }
      />
      <div className="stack">
        <div className="grid-2">
          <IdentityCard data={data} />
          <Card title={`Cases (${data.cases.length})`} flush>
            {data.view === 'staff' ? (
              <DataTable columns={staffCaseColumns} rows={data.cases} rowKey={(row) => row.case_number} emptyState={<EmptyState title="No cases" />} caption="Cases" />
            ) : (
              <DataTable columns={publicCaseColumns} rows={data.cases} rowKey={(row) => row.case_number} emptyState={<EmptyState title="No cases" />} caption="Cases" />
            )}
          </Card>
        </div>
        {data.view === 'staff' && <StaffSections data={data} />}
      </div>
    </>
  );
}

export default PlayerDetailPage;
