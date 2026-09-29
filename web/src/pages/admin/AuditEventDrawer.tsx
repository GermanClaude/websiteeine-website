/**
 * Details of one audit event (§9): metadata, chain hashes and request id, shown in a modal.
 */
import { AuditTargetType, isCaseNumber, type AuditEventView } from '@scpsl-trust/shared';

import { CodeBlock } from '../../components/CodeBlock';
import { CopyButton } from '../../components/CopyButton';
import { DateTime } from '../../components/DateTime';
import { KeyValueList } from '../../components/KeyValueList';
import { CaseLink, ServerLink } from '../../components/Links';
import { Modal } from '../../components/Modal';
import { StatusBadge, humanizeEnum } from '../../components/StatusBadge';

export interface AuditEventDrawerProps {
  event: AuditEventView | null;
  onClose: () => void;
}

export function AuditTargetCell({ event }: { event: Pick<AuditEventView, 'target_type' | 'target_id'> }) {
  if (event.target_id === null) return <span className="text-muted">{humanizeEnum(event.target_type)}</span>;
  if (event.target_type === AuditTargetType.CASE && isCaseNumber(event.target_id)) return <CaseLink caseNumber={event.target_id} />;
  if (event.target_type === AuditTargetType.SERVER && event.target_id.startsWith('srv_')) return <ServerLink serverId={event.target_id} />;
  return (
    <span>
      <span className="text-muted">{humanizeEnum(event.target_type)}</span> <span className="mono text-xs break-all">{event.target_id}</span>
    </span>
  );
}

export function AuditEventDrawer({ event, onClose }: AuditEventDrawerProps) {
  return (
    <Modal open={event !== null} title={event === null ? 'Audit event' : `Event #${event.seq}`} onClose={onClose} size="lg">
      {event !== null && (
        <div className="stack">
          <KeyValueList
            items={[
              { label: 'Action', value: <StatusBadge kind="auditAction" value={event.action} /> },
              { label: 'When', value: <DateTime value={event.created_at} /> },
              {
                label: 'Actor',
                value: (
                  <span className="row" style={{ gap: 6 }}>
                    <StatusBadge kind="actorType" value={event.actor_type} />
                    {event.actor_label !== null && <span>{event.actor_label}</span>}
                    {event.actor_id !== null && <span className="mono text-xs text-muted break-all">{event.actor_id}</span>}
                  </span>
                ),
              },
              { label: 'Target', value: <AuditTargetCell event={event} /> },
              { label: 'Server (internal id)', value: event.server_id === null ? null : <span className="mono text-xs">{event.server_id}</span> },
              { label: 'Case (internal id)', value: event.case_id === null ? null : <span className="mono text-xs">{event.case_id}</span> },
              { label: 'Request id', value: event.request_id === null ? null : <span className="mono text-xs break-all">{event.request_id}</span> },
              {
                label: 'Event id',
                value: (
                  <span className="row" style={{ gap: 6 }}>
                    <span className="mono text-xs break-all">{event.event_id}</span>
                    <CopyButton value={event.event_id} />
                  </span>
                ),
              },
              { label: 'Hash', value: <span className="mono text-xs break-all">{event.hash}</span> },
              { label: 'Previous hash', value: <span className="mono text-xs break-all">{event.prev_hash}</span> },
            ]}
          />
          <div>
            <div className="text-xs text-muted mb-2">Metadata (never contains secrets, tokens or raw IP addresses)</div>
            <CodeBlock value={JSON.stringify(event.metadata, null, 2)} />
          </div>
        </div>
      )}
    </Modal>
  );
}
