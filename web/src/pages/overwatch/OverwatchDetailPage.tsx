/**
 * Overwatch session detail (`GET /overwatch/sessions/{id}`, overwatch:view). No secret exists in
 * this view; the page links to the proof verification form pre-filled with the session's ids.
 */
import { useQuery } from '@tanstack/react-query';
import { useParams } from 'react-router';

import { getOverwatchSession, overwatchKeys } from '../../api/overwatch';
import { Badge } from '../../components/Badge';
import { LinkButton } from '../../components/Button';
import { Card } from '../../components/Card';
import { DateTime, RelativeTime } from '../../components/DateTime';
import { ErrorState } from '../../components/ErrorState';
import { KeyValueList } from '../../components/KeyValueList';
import { ServerLink, UserIdLink } from '../../components/Links';
import { PageHeader } from '../../components/PageHeader';
import { LoadingState } from '../../components/Spinner';
import { StatusBadge } from '../../components/StatusBadge';

function durationLabel(startIso: string, endIso: string | null): string {
  const start = Date.parse(startIso);
  const end = endIso === null ? Date.now() : Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '—';
  const seconds = Math.round((end - start) / 1000);
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes} min ${rest} s` : `${rest} s`;
}

export function OverwatchDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params.id ?? '';
  const session = useQuery({ queryKey: overwatchKeys.detail(id), queryFn: () => getOverwatchSession(id), enabled: id !== '' });
  const breadcrumbs = [{ label: 'Overwatch sessions', to: '/overwatch' }, { label: id.slice(0, 8) }];

  if (session.isPending) {
    return (
      <>
        <PageHeader title="Overwatch session" breadcrumbs={breadcrumbs} />
        <LoadingState />
      </>
    );
  }
  if (session.isError) {
    return (
      <>
        <PageHeader title="Overwatch session" breadcrumbs={breadcrumbs} />
        <ErrorState error={session.error} onRetry={() => void session.refetch()} />
      </>
    );
  }

  const data = session.data;
  const proofParams = new URLSearchParams({
    server_id: data.server.server_id,
    player_id: data.target.user_id,
    spectator_id: data.spectator.user_id,
    session_id: data.id,
    timestamp: String(Date.parse(data.started_at)),
  });

  return (
    <>
      <PageHeader
        title={`Session ${data.id.slice(0, 8)}`}
        documentTitle={`Overwatch session ${data.id.slice(0, 8)}`}
        breadcrumbs={breadcrumbs}
        badges={
          <span className="row" style={{ marginLeft: 8, display: 'inline-flex' }}>
            <StatusBadge kind="overwatchStatus" value={data.status} dot />
            {data.proof_verifiable ? <Badge tone="success">proofs verifiable</Badge> : <Badge tone="muted">proofs no longer verifiable</Badge>}
          </span>
        }
        subtitle={
          <span className="row">
            <ServerLink serverId={data.server.server_id} name={data.server.name} />
            <span className="text-muted">
              · started <RelativeTime value={data.started_at} />
            </span>
          </span>
        }
        actions={
          <LinkButton to={`/tools/proof?${proofParams.toString()}`} variant="primary">
            Verify a proof code
          </LinkButton>
        }
      />
      <div className="grid-2">
        <Card title="Session">
          <KeyValueList
            items={[
              { label: 'Session id', value: <span className="mono text-xs break-all">{data.id}</span> },
              { label: 'Server', value: <ServerLink serverId={data.server.server_id} name={data.server.name} /> },
              { label: 'Target player', value: <UserIdLink userId={data.target.user_id} displayName={data.target.display_name} showType /> },
              { label: 'Spectator', value: <UserIdLink userId={data.spectator.user_id} displayName={data.spectator.display_name} showType /> },
              { label: 'Status', value: <StatusBadge kind="overwatchStatus" value={data.status} dot /> },
              { label: 'Code interval', value: `${data.interval_seconds} s` },
              { label: 'Started', value: <DateTime value={data.started_at} /> },
              { label: 'Last heartbeat', value: <DateTime value={data.last_heartbeat_at} /> },
              { label: 'Ended', value: <DateTime value={data.ended_at} empty={data.status === 'active' ? 'still running' : '—'} /> },
              { label: 'Effective end', value: <DateTime value={data.effective_end_at} empty="now (active)" /> },
              { label: 'Duration', value: durationLabel(data.started_at, data.effective_end_at) },
              { label: 'End reason', value: data.end_reason === null ? null : <StatusBadge kind="overwatchEndReason" value={data.end_reason} /> },
              { label: 'Created', value: <DateTime value={data.created_at} /> },
            ]}
          />
        </Card>
        <Card title="About proof sessions">
          <ul className="text-sm" style={{ margin: 0, paddingLeft: '1.2em' }}>
            <li>The plugin starts a session when staff spectate a player in Overwatch mode and shows a rotating code in the spectator&apos;s view.</li>
            <li>The session secret is known only to the backend and that server; it is never shown here and is wiped by retention after a while.</li>
            <li>Anyone can verify a code from a recording with the proof tool — the answer is only whether the code belongs to this session and time window.</li>
            <li>
              <strong>A verified session proves who recorded whom.</strong> It does not prove cheating; reviewers assess the recording separately on the evidence.
            </li>
          </ul>
        </Card>
      </div>
    </>
  );
}

export default OverwatchDetailPage;
