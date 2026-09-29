/**
 * Whitelist request table with optional staff actions (approve / reject / revoke).
 */
import type { ReactNode } from 'react';
import { useState } from 'react';

import type { WhitelistRequestView } from '@scpsl-trust/shared';

import { Button } from '../../components/Button';
import { DataTable, type Column } from '../../components/DataTable';
import { DateTime, RelativeTime } from '../../components/DateTime';
import { EmptyState } from '../../components/EmptyState';
import { ServerLink, UserIdLink } from '../../components/Links';
import { StatusBadge } from '../../components/StatusBadge';
import { WhitelistDialogs, type WhitelistDialogState } from './WhitelistDialogs';

export interface WhitelistRequestTableProps {
  rows: readonly WhitelistRequestView[];
  loading?: boolean;
  error?: ReactNode;
  /** Staff view: decide on pending requests and revoke approved ones. */
  canDecide: boolean;
  /** Hide the requester column (own requests). */
  mine?: boolean;
  emptyState?: ReactNode;
  highlightId?: string | null;
}

export function WhitelistRequestTable({ rows, loading = false, error, canDecide, mine = false, emptyState, highlightId = null }: WhitelistRequestTableProps) {
  const [dialog, setDialog] = useState<WhitelistDialogState>(null);

  const columns: Column<WhitelistRequestView>[] = [
    { key: 'server', header: 'Server', render: (row) => <ServerLink serverId={row.server.server_id} name={row.server.name} /> },
    { key: 'type', header: 'Type', render: (row) => <StatusBadge kind="whitelistType" value={row.type} /> },
  ];
  if (!mine) {
    columns.push({
      key: 'player',
      header: 'Player',
      render: (row) => (
        <span className="stack-sm" style={{ gap: 0 }}>
          <UserIdLink userId={row.player.user_id} displayName={row.player.display_name} />
          <span className="text-xs text-muted">by {row.requester.username}</span>
        </span>
      ),
    });
  }
  columns.push(
    { key: 'status', header: 'Status', render: (row) => <StatusBadge kind="whitelistStatus" value={row.status} dot />, sortValue: (row) => row.status },
    { key: 'reason', header: 'Reason', wrap: true, render: (row) => row.reason },
    { key: 'days', header: 'Requested', render: (row) => (row.requested_days === null ? <span className="text-muted">no limit</span> : `${row.requested_days} d`) },
    { key: 'created', header: 'Submitted', render: (row) => <DateTime value={row.created_at} />, sortValue: (row) => row.created_at },
    {
      key: 'decision',
      header: 'Decision',
      wrap: true,
      render: (row) =>
        row.decided_at === null ? (
          row.status === 'pending' ? (
            <span className="text-xs text-muted">
              Expires <RelativeTime value={row.expires_at} />
            </span>
          ) : (
            <span className="text-faint">—</span>
          )
        ) : (
          <span className="text-xs">
            <DateTime value={row.decided_at} /> {row.decided_by !== null && <span className="text-muted">by {row.decided_by.username}</span>}
            {row.decision_note !== null && row.decision_note !== '' && <div className="text-muted">{row.decision_note}</div>}
          </span>
        ),
    },
    {
      key: 'bypass',
      header: 'Bypass expires',
      render: (row) =>
        row.status === 'approved' ? row.bypass_expires_at === null ? <span className="text-muted">never</span> : <RelativeTime value={row.bypass_expires_at} /> : <span className="text-faint">—</span>,
    },
  );
  if (canDecide) {
    columns.push({
      key: 'actions',
      header: '',
      align: 'right',
      render: (row) => (
        <span className="row" style={{ justifyContent: 'flex-end', gap: 4 }}>
          {row.status === 'pending' && (
            <>
              <Button size="sm" variant="primary" onClick={() => setDialog({ kind: 'approve', request: row })}>
                Approve
              </Button>
              <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'reject', request: row })}>
                Reject
              </Button>
            </>
          )}
          {row.status === 'approved' && (
            <Button size="sm" variant="danger" onClick={() => setDialog({ kind: 'revoke', request: row })}>
              Revoke
            </Button>
          )}
        </span>
      ),
    });
  }

  return (
    <>
      <DataTable
        columns={columns}
        rows={rows}
        rowKey={(row) => row.id}
        loading={loading}
        error={error}
        emptyState={emptyState ?? <EmptyState title="No whitelist requests" />}
        rowClassName={(row) => (row.id === highlightId ? 'table-row-highlight' : undefined)}
      />
      <WhitelistDialogs state={dialog} onClose={() => setDialog(null)} />
    </>
  );
}
