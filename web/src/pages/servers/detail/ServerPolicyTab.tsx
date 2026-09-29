/**
 * Policy tab: loads the active policy, hosts the editor (Requirements §23) and saves new versions.
 * The API exposes only the active version; POLICY_UPDATED audit events are the change history.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router';

import { AuditAction, type ServerPolicyUpdateRequestInput, type ServerPolicyView, type ServerView } from '@scpsl-trust/shared';

import { ApiError } from '../../../api/client';
import { getServerPolicy, policyKeys, updateServerPolicy } from '../../../api/policies';
import { serverKeys } from '../../../api/servers';
import { Card } from '../../../components/Card';
import { DateTime } from '../../../components/DateTime';
import { ErrorState } from '../../../components/ErrorState';
import { LoadingState } from '../../../components/Spinner';
import { useToast } from '../../../components/Toasts';
import { PolicyEditor } from '../policy/PolicyEditor';
import type { ServerAbilities } from '../serverUtils';

export interface ServerPolicyTabProps {
  server: ServerView;
  abilities: ServerAbilities;
  canViewAudit: boolean;
}

interface SavedVersion {
  version: number;
  created_at: string;
  created_by: string | null;
  rules: number;
  replaced_by: number;
}

function versionEntry(policy: ServerPolicyView, replacedBy: number): SavedVersion {
  return {
    version: policy.version,
    created_at: policy.created_at,
    created_by: policy.created_by?.username ?? null,
    rules: policy.rules.length,
    replaced_by: replacedBy,
  };
}

export function ServerPolicyTab({ server, abilities, canViewAudit }: ServerPolicyTabProps) {
  const toast = useToast();
  const queryClient = useQueryClient();
  const [history, setHistory] = useState<SavedVersion[]>([]);

  const policy = useQuery({ queryKey: policyKeys.detail(server.server_id), queryFn: () => getServerPolicy(server.server_id) });

  const save = useMutation({
    mutationFn: (request: ServerPolicyUpdateRequestInput) => updateServerPolicy(server.server_id, request),
    onSuccess: async (saved) => {
      const previous = queryClient.getQueryData<ServerPolicyView>(policyKeys.detail(server.server_id));
      if (previous !== undefined) {
        setHistory((current) => [versionEntry(previous, saved.version), ...current.filter((entry) => entry.version !== previous.version)]);
      }
      queryClient.setQueryData(policyKeys.detail(server.server_id), saved);
      toast.success(`Policy saved as version ${saved.version}. The plugin picks it up on its next refresh.`);
      await queryClient.invalidateQueries({ queryKey: serverKeys.detail(server.server_id) });
    },
  });

  if (policy.isPending) return <LoadingState label="Loading policy…" />;
  if (policy.isError) {
    const forbidden = ApiError.is(policy.error) && policy.error.isForbidden;
    return (
      <ErrorState
        error={policy.error}
        title={forbidden ? 'Policy not visible' : undefined}
        onRetry={forbidden ? undefined : () => void policy.refetch()}
      >
        {forbidden && <p className="text-sm text-muted">Only owners and admins of this server (or network administrators) can view its policy.</p>}
      </ErrorState>
    );
  }

  const active = policy.data;
  const auditLink = `/admin/audit?server_id=${encodeURIComponent(server.server_id)}&action=${AuditAction.POLICY_UPDATED}`;

  return (
    <div className="stack">
      <Card title="Active policy">
        <div className="row-between">
          <dl className="kv" style={{ margin: 0 }}>
            <dt className="kv-key">Version</dt>
            <dd className="kv-value">
              v{active.version} {active.is_active ? '' : '(not active)'}
            </dd>
            <dt className="kv-key">Saved</dt>
            <dd className="kv-value">
              <DateTime value={active.created_at} /> {active.created_by !== null && <span className="text-muted">by {active.created_by.username}</span>}
            </dd>
            <dt className="kv-key">Rules</dt>
            <dd className="kv-value">{active.rules.length}</dd>
          </dl>
          <div className="text-xs text-muted">
            {abilities.policy ? 'Saving creates a new version; previous versions are kept immutably.' : 'Read-only: only owners and admins can change the policy.'}
          </div>
        </div>
      </Card>

      <PolicyEditor
        serverId={server.server_id}
        serverName={server.name}
        policy={active}
        onSave={async (request) => {
          await save.mutateAsync(request);
        }}
        saving={save.isPending}
        saveError={save.error}
        readOnly={!abilities.policy || server.status === 'revoked'}
      />

      <Card title="Version history">
        <div className="stack-sm text-sm">
          {history.length === 0 ? (
            <p className="text-muted">
              Versions replaced during this session appear here. Every change is recorded as a <code>POLICY_UPDATED</code> audit event
              {canViewAudit ? (
                <>
                  {' '}
                  — <Link to={auditLink}>show the audit trail of this server</Link>.
                </>
              ) : (
                '.'
              )}
            </p>
          ) : (
            <ul className="stack-sm" style={{ paddingLeft: 'var(--sp-4)' }}>
              {history.map((entry) => (
                <li key={entry.version}>
                  <strong>v{entry.version}</strong> — {entry.rules} rules, saved <DateTime value={entry.created_at} />
                  {entry.created_by !== null && <span className="text-muted"> by {entry.created_by}</span>}
                  <span className="text-muted"> (replaced by v{entry.replaced_by})</span>
                </li>
              ))}
              {canViewAudit && (
                <li>
                  <Link to={auditLink}>Full change history in the audit log</Link>
                </li>
              )}
            </ul>
          )}
        </div>
      </Card>
    </div>
  );
}
