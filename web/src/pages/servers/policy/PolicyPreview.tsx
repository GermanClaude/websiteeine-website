/**
 * "What would happen?" panel: builds a sample player check, evaluates the current draft with the
 * shared engine (client-side, instant) and optionally asks the backend to evaluate the same
 * draft (POST /servers/{id}/policy/preview) to prove both agree.
 */
import { useMutation } from '@tanstack/react-query';
import { useMemo, useState } from 'react';

import {
  ALT_CONFIDENCES,
  BYPASS_TYPES,
  GLOBAL_STATUSES,
  PolicyEvaluationInputSchema,
  VPN_CONFIDENCES,
  evaluatePolicy,
  type AltConfidence,
  type BypassType,
  type GlobalStatus,
  type PolicyDecision,
  type PolicyEvaluationInput,
  type PolicyPreviewResponse,
  type VpnConfidence,
} from '@scpsl-trust/shared';

import { previewServerPolicy } from '../../../api/policies';
import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { ErrorState } from '../../../components/ErrorState';
import { Input, Select } from '../../../components/FormField';
import { StatusBadge, humanizeEnum } from '../../../components/StatusBadge';
import { ACTION_LABELS, type PolicyDraft, validateDraft } from './policyDraft';

export interface PreviewSample {
  global_status: GlobalStatus;
  case_id: string;
  confirmed_servers: string;
  open_reports: string;
  account_age_days: string;
  account_age_unknown: boolean;
  vpn_confidence: VpnConfidence;
  alt_possible: boolean;
  alt_confidence: AltConfidence;
  alt_linked_confirmed_case: boolean;
  bypass_types: BypassType[];
}

export const DEFAULT_SAMPLE: PreviewSample = {
  global_status: 'none',
  case_id: '',
  confirmed_servers: '0',
  open_reports: '0',
  account_age_days: '30',
  account_age_unknown: false,
  vpn_confidence: 'not_detected',
  alt_possible: false,
  alt_confidence: 'none',
  alt_linked_confirmed_case: false,
  bypass_types: [],
};

function toInt(raw: string): number {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/** Sample → engine input (invalid numbers fall back to 0; the case id must be a real case number to be used). */
export function sampleToInput(sample: PreviewSample): PolicyEvaluationInput {
  const caseId = sample.case_id.trim();
  const candidate = {
    global_status: sample.global_status,
    case_id: /^CASE-\d{4}-\d{6}$/.test(caseId) ? caseId : null,
    confirmed_servers: toInt(sample.confirmed_servers),
    open_reports: toInt(sample.open_reports),
    account_age: { days: sample.account_age_unknown ? null : toInt(sample.account_age_days) },
    vpn: { confidence: sample.vpn_confidence },
    alt_account: {
      possible: sample.alt_possible,
      confidence: sample.alt_possible ? sample.alt_confidence : 'none',
      linked_confirmed_cases: sample.alt_possible && sample.alt_linked_confirmed_case ? ['CASE-2026-000001'] : [],
    },
    bypass: { types: sample.bypass_types },
  };
  return PolicyEvaluationInputSchema.parse(candidate);
}

export interface PolicyPreviewProps {
  serverId: string;
  serverName: string;
  draft: PolicyDraft;
  baseVersion: number | null;
}

function DecisionView({ decision, title, meta }: { decision: PolicyDecision; title: string; meta?: string }) {
  return (
    <div className="stack-sm">
      <div className="row-between">
        <strong className="text-sm">{title}</strong>
        {meta !== undefined && <span className="text-xs text-muted">{meta}</span>}
      </div>
      <div className="policy-decision">
        <span className="text-muted">Action</span>
        <span className="row">
          <span className="policy-decision-action">{ACTION_LABELS[decision.action] ?? decision.action}</span>
          <StatusBadge kind="policyAction" value={decision.action} />
        </span>
        <span className="text-muted">Notify staff</span>
        <span>{decision.notify_admins ? 'Yes' : 'No'}</span>
        {decision.action === 'ban' && (
          <>
            <span className="text-muted">Ban duration</span>
            <span>{decision.ban_duration_minutes === 0 || decision.ban_duration_minutes === null ? 'Permanent' : `${decision.ban_duration_minutes} min`}</span>
          </>
        )}
        <span className="text-muted">Message</span>
        <span>{decision.message === null || decision.message === '' ? <span className="text-faint">none</span> : decision.message}</span>
      </div>
      <div>
        <div className="text-xs text-muted mb-2">Applied rules</div>
        {decision.applied.length === 0 ? (
          <div className="text-sm text-faint">No rule matched.</div>
        ) : (
          <ul className="policy-outcomes">
            {decision.applied.map((outcome) => (
              <li key={`${outcome.rule_id}-applied`}>
                <StatusBadge kind="policySignal" value={outcome.signal} />
                <StatusBadge kind="policyAction" value={outcome.action} />
                <span className="text-muted text-xs">{humanizeEnum(outcome.reason_code)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {decision.bypassed.length > 0 && (
        <div>
          <div className="text-xs text-muted mb-2">Bypassed rules (an active bypass exempts them)</div>
          <ul className="policy-outcomes">
            {decision.bypassed.map((outcome) => (
              <li key={`${outcome.rule_id}-bypassed`}>
                <StatusBadge kind="policySignal" value={outcome.signal} />
                <StatusBadge kind="policyAction" value={outcome.action} />
                <Badge tone="muted">bypassed</Badge>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function PolicyPreview({ serverId, serverName, draft, baseVersion }: PolicyPreviewProps) {
  const [sample, setSample] = useState<PreviewSample>(DEFAULT_SAMPLE);
  const [remote, setRemote] = useState<PolicyPreviewResponse | null>(null);
  const patch = (next: Partial<PreviewSample>) => {
    setSample((current) => ({ ...current, ...next }));
    setRemote(null);
  };

  const validated = useMemo(() => validateDraft(draft, baseVersion), [draft, baseVersion]);
  const input = useMemo(() => sampleToInput(sample), [sample]);
  const local = useMemo<PolicyDecision | null>(() => {
    if (!validated.ok) return null;
    return evaluatePolicy(input, validated.policy, { server_name: serverName });
  }, [validated, input, serverName]);

  const remoteEval = useMutation({
    mutationFn: async (): Promise<PolicyPreviewResponse> => {
      if (!validated.ok) throw new Error('Fix the validation errors first');
      const { version: _version, ...policy } = validated.policy;
      return previewServerPolicy(serverId, { input, policy });
    },
    onSuccess: (response) => setRemote(response),
  });

  const toggleBypass = (type: BypassType, checked: boolean) => {
    const next = checked ? [...sample.bypass_types, type] : sample.bypass_types.filter((value) => value !== type);
    patch({ bypass_types: BYPASS_TYPES.filter((value) => next.includes(value)) });
  };

  return (
    <div className="policy-preview stack">
      <Card title="Preview: what would this server do?">
        <div className="stack-sm">
          <div className="alert alert-info">
            <div className="alert-title">The backend never enforces — this server decides.</div>
            The preview runs the same policy engine the plugin uses. Build a sample player and see the resulting action.
          </div>
          <div className="form-grid policy-preview-form">
            <Select
              label="Global status"
              options={GLOBAL_STATUSES.map((status) => ({ value: status, label: humanizeEnum(status) }))}
              value={sample.global_status}
              onChange={(event) => patch({ global_status: event.target.value as GlobalStatus })}
            />
            <Input label="Confirming servers" type="number" min={0} inputMode="numeric" value={sample.confirmed_servers} onChange={(event) => patch({ confirmed_servers: event.target.value })} />
            <Input label="Open reports" type="number" min={0} inputMode="numeric" value={sample.open_reports} onChange={(event) => patch({ open_reports: event.target.value })} />
            <Input
              label="Account age (days)"
              type="number"
              min={0}
              inputMode="numeric"
              value={sample.account_age_days}
              disabled={sample.account_age_unknown}
              onChange={(event) => patch({ account_age_days: event.target.value })}
            />
            <label className="policy-inline-check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={sample.account_age_unknown} onChange={(event) => patch({ account_age_unknown: event.target.checked })} />
              Account age unknown
            </label>
            <Select
              label="VPN confidence"
              options={VPN_CONFIDENCES.map((value) => ({ value, label: humanizeEnum(value) }))}
              value={sample.vpn_confidence}
              onChange={(event) => patch({ vpn_confidence: event.target.value as VpnConfidence })}
            />
            <label className="policy-inline-check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={sample.alt_possible} onChange={(event) => patch({ alt_possible: event.target.checked })} />
              Possible alt account
            </label>
            <Select
              label="Alt confidence"
              options={ALT_CONFIDENCES.map((value) => ({ value, label: humanizeEnum(value) }))}
              value={sample.alt_confidence}
              disabled={!sample.alt_possible}
              onChange={(event) => patch({ alt_confidence: event.target.value as AltConfidence })}
            />
            <label className="policy-inline-check" style={{ alignSelf: 'end' }}>
              <input
                type="checkbox"
                checked={sample.alt_linked_confirmed_case}
                disabled={!sample.alt_possible}
                onChange={(event) => patch({ alt_linked_confirmed_case: event.target.checked })}
              />
              Linked account has a confirmed case
            </label>
            <Input label="Case id (for {case_id})" mono placeholder="CASE-2026-000001" value={sample.case_id} onChange={(event) => patch({ case_id: event.target.value })} />
          </div>
          <fieldset className="field">
            <legend className="field-label">Active bypasses of the player</legend>
            <div className="policy-checkgroup">
              {BYPASS_TYPES.map((type) => (
                <label key={type}>
                  <input type="checkbox" checked={sample.bypass_types.includes(type)} onChange={(event) => toggleBypass(type, event.target.checked)} />
                  {humanizeEnum(type)}
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Card>

      <Card
        title="Decision"
        actions={
          <Button size="sm" onClick={() => remoteEval.mutate()} loading={remoteEval.isPending} disabled={!validated.ok}>
            Evaluate on backend
          </Button>
        }
      >
        {!validated.ok ? (
          <div className="alert alert-warning">Fix the validation errors in the editor to preview the draft.</div>
        ) : local === null ? null : (
          <div className="stack">
            <DecisionView decision={local} title="Client-side (shared engine, current draft)" />
            {remoteEval.isError && <ErrorState error={remoteEval.error} compact title="Backend preview failed" />}
            {remote !== null && (
              <>
                <hr className="divider" />
                <DecisionView
                  decision={remote.decision}
                  title="Backend evaluation"
                  meta={remote.policy_version === null ? 'evaluated the unsaved draft' : `stored policy v${remote.policy_version}`}
                />
                {JSON.stringify(remote.decision) === JSON.stringify(local) ? (
                  <div className="alert alert-success">Backend and client agree.</div>
                ) : (
                  <div className="alert alert-warning">Backend and client decisions differ — compare the two results above.</div>
                )}
              </>
            )}
          </div>
        )}
      </Card>
    </div>
  );
}
