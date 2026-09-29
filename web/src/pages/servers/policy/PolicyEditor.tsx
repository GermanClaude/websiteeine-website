/**
 * Policy editor (Requirements §23, ARCHITECTURE §7): sections per signal, rule rows, options,
 * validation with the shared ServerPolicySchema and a live preview.
 */
import { useMemo, useState, type FormEvent } from 'react';

import { BACKEND_UNAVAILABLE_ACTIONS, LIMITS, type BackendUnavailableAction, type PolicySignal, type ServerPolicyUpdateRequestInput, type ServerPolicyView } from '@scpsl-trust/shared';

import { Badge } from '../../../components/Badge';
import { Button } from '../../../components/Button';
import { Card } from '../../../components/Card';
import { FormError } from '../../../components/ErrorState';
import { Checkbox, Input, Select } from '../../../components/FormField';
import { StatusBadge } from '../../../components/StatusBadge';
import './policy.css';
import {
  BACKEND_UNAVAILABLE_LABELS,
  SIGNAL_DESCRIPTIONS,
  SIGNAL_LABELS,
  SIGNAL_ORDER,
  addRule,
  draftEquals,
  draftFromPolicy,
  moveRule,
  removeRule,
  rulesForSignal,
  updateRule,
  validateDraft,
  type PolicyDraft,
  type PolicyDraftErrors,
} from './policyDraft';
import { PolicyPreview } from './PolicyPreview';
import { PolicyRuleRow } from './PolicyRuleRow';

export interface PolicyEditorProps {
  serverId: string;
  serverName: string;
  policy: ServerPolicyView;
  /** Saves the request; resolves when the new version is active. */
  onSave: (request: ServerPolicyUpdateRequestInput) => Promise<void>;
  saving: boolean;
  /** Server-side error of the last save (shown above the save bar). */
  saveError: unknown;
  readOnly?: boolean;
}

const EMPTY_ERRORS: PolicyDraftErrors = { form: [], settings: {}, rules: {} };
const NO_RULE_ERRORS: Readonly<Record<string, string>> = {};

export function PolicyEditor({ serverId, serverName, policy, onSave, saving, saveError, readOnly = false }: PolicyEditorProps) {
  const initial = useMemo(() => draftFromPolicy(policy), [policy]);
  const [draft, setDraft] = useState<PolicyDraft>(initial);
  const [errors, setErrors] = useState<PolicyDraftErrors>(EMPTY_ERRORS);
  const [baseline, setBaseline] = useState(policy.version);

  // A new stored version (after save or a refetch) replaces the draft.
  if (baseline !== policy.version) {
    setBaseline(policy.version);
    setDraft(initial);
    setErrors(EMPTY_ERRORS);
  }

  const dirty = !draftEquals(draft, initial);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const result = validateDraft(draft, policy.version);
    if (!result.ok) {
      setErrors(result.errors);
      return;
    }
    setErrors(EMPTY_ERRORS);
    await onSave(result.request);
  };

  const revalidate = (next: PolicyDraft) => {
    setDraft(next);
    // Clear stale errors as soon as the user edits; full validation runs on save.
    if (errors !== EMPTY_ERRORS) {
      const result = validateDraft(next, policy.version);
      setErrors(result.ok ? EMPTY_ERRORS : result.errors);
    }
  };

  const ruleCount = draft.rules.length;

  return (
    <div className="policy-layout">
      <form onSubmit={(event) => void submit(event)} noValidate aria-label="Policy editor">
        <Card
          title={
            <span className="row">
              Policy rules
              <Badge tone="neutral">
                v{policy.version} · {ruleCount}/{LIMITS.POLICY_RULES_MAX} rules
              </Badge>
              {dirty && <Badge tone="warning">Unsaved changes</Badge>}
            </span>
          }
          flush
        >
          <div className="card-body">
            <div className="alert alert-info mb-4">
              <div className="alert-title">The backend never enforces — this server decides.</div>
              Rules are evaluated in order; the most severe matching action wins. Saving creates a new policy version that the plugin
              fetches on its next refresh.
            </div>

            {SIGNAL_ORDER.map((signal) => (
              <PolicySection
                key={signal}
                signal={signal}
                draft={draft}
                errors={errors}
                readOnly={readOnly || saving}
                onAdd={() => revalidate(addRule(draft, signal))}
                onChange={(key, patch) => revalidate(updateRule(draft, key, patch))}
                onMove={(key, direction) => revalidate(moveRule(draft, key, direction))}
                onRemove={(key) => revalidate(removeRule(draft, key))}
              />
            ))}

            <section className="policy-section" aria-labelledby="policy-options-title">
              <h3 id="policy-options-title" className="text-sm" style={{ marginBottom: 'var(--sp-2)' }}>
                When the backend is unavailable
              </h3>
              <p className="policy-section-desc">Applies when the plugin cannot reach the network at all (timeouts, outages). The cached last policy is used for everything else.</p>
              <div className="form-grid">
                <Select
                  label="Action"
                  options={BACKEND_UNAVAILABLE_ACTIONS.map((action) => ({ value: action, label: BACKEND_UNAVAILABLE_LABELS[action] }))}
                  value={draft.backend_unavailable_action}
                  disabled={readOnly || saving}
                  error={errors.settings.backend_unavailable_action}
                  onChange={(event) => revalidate({ ...draft, backend_unavailable_action: event.target.value as BackendUnavailableAction })}
                />
              </div>
            </section>

            <section className="policy-section" aria-labelledby="policy-general-title">
              <h3 id="policy-general-title" className="text-sm" style={{ marginBottom: 'var(--sp-2)' }}>
                Options
              </h3>
              <div className="form-grid">
                <Input
                  label="Whitelist URL (optional)"
                  type="url"
                  placeholder="https://example.org/whitelist"
                  value={draft.whitelist_url}
                  disabled={readOnly || saving}
                  error={errors.settings.whitelist_url}
                  hint="Substituted for {whitelist_url} in messages, e.g. the page where players request a VPN whitelist."
                  onChange={(event) => revalidate({ ...draft, whitelist_url: event.target.value })}
                />
                <div className="stack-sm" style={{ alignSelf: 'end' }}>
                  <Checkbox
                    label="Notify staff on every enforcement (warn or stronger)"
                    checked={draft.notify_on_enforcement}
                    disabled={readOnly || saving}
                    error={errors.settings.notify_on_enforcement}
                    onChange={(event) => revalidate({ ...draft, notify_on_enforcement: event.target.checked })}
                  />
                  <Checkbox
                    label="Honor global bypasses granted by network admins"
                    checked={draft.honor_global_bypasses}
                    disabled={readOnly || saving}
                    error={errors.settings.honor_global_bypasses}
                    hint="Off: only bypasses granted for this server count."
                    onChange={(event) => revalidate({ ...draft, honor_global_bypasses: event.target.checked })}
                  />
                </div>
              </div>
            </section>
          </div>

          <div className="policy-savebar">
            <Button type="submit" variant="primary" loading={saving} disabled={readOnly || !dirty}>
              Save as version {policy.version + 1}
            </Button>
            <Button
              variant="ghost"
              disabled={saving || !dirty}
              onClick={() => {
                setDraft(initial);
                setErrors(EMPTY_ERRORS);
              }}
            >
              Discard changes
            </Button>
            {errors.form.length > 0 && (
              <div className="text-sm text-danger" role="alert">
                {errors.form.join('; ')}
              </div>
            )}
            {Object.keys(errors.rules).length > 0 && (
              <div className="text-sm text-danger" role="alert">
                Some rules have errors. Fix them before saving.
              </div>
            )}
            <div style={{ flexBasis: '100%' }}>
              <FormError error={saveError} />
            </div>
          </div>
        </Card>
      </form>

      <PolicyPreview serverId={serverId} serverName={serverName} draft={draft} baseVersion={policy.version} />
    </div>
  );
}

interface PolicySectionProps {
  signal: PolicySignal;
  draft: PolicyDraft;
  errors: PolicyDraftErrors;
  readOnly: boolean;
  onAdd: () => void;
  onChange: (key: string, patch: Parameters<typeof updateRule>[2]) => void;
  onMove: (key: string, direction: 'up' | 'down') => void;
  onRemove: (key: string) => void;
}

function PolicySection({ signal, draft, errors, readOnly, onAdd, onChange, onMove, onRemove }: PolicySectionProps) {
  const rules = rulesForSignal(draft, signal);
  const headingId = `policy-section-${signal}`;
  return (
    <section className="policy-section" aria-labelledby={headingId}>
      <div className="row-between" style={{ marginBottom: 'var(--sp-1)' }}>
        <h3 id={headingId} className="text-sm row">
          <StatusBadge kind="policySignal" value={signal} label={SIGNAL_LABELS[signal]} />
          <span className="text-muted text-xs">
            {rules.length} {rules.length === 1 ? 'rule' : 'rules'}
          </span>
        </h3>
        <Button size="sm" onClick={onAdd} disabled={readOnly || draft.rules.length >= LIMITS.POLICY_RULES_MAX}>
          Add rule
        </Button>
      </div>
      <p className="policy-section-desc">{SIGNAL_DESCRIPTIONS[signal]}</p>
      <div className="policy-rules">
        {rules.length === 0 ? (
          <div className="text-sm text-faint">No rule — this signal is ignored by the server.</div>
        ) : (
          rules.map((rule, index) => (
            <PolicyRuleRow
              key={rule.key}
              rule={rule}
              position={index + 1}
              total={rules.length}
              errors={errors.rules[rule.key] ?? NO_RULE_ERRORS}
              disabled={readOnly}
              onChange={(patch) => onChange(rule.key, patch)}
              onMove={(direction) => onMove(rule.key, direction)}
              onRemove={() => onRemove(rule.key)}
            />
          ))
        )}
      </div>
    </section>
  );
}
