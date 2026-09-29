import { useId } from 'react';

import { GLOBAL_STATUSES, LIMITS, POLICY_ACTIONS, POLICY_MESSAGE_PLACEHOLDERS, type GlobalStatus, type PolicyAction } from '@scpsl-trust/shared';

import { IconButton } from '../../../components/Button';
import { Input, Select } from '../../../components/FormField';
import { humanizeEnum } from '../../../components/StatusBadge';
import { ACTION_LABELS, type MinAltConfidence, type MinVpnConfidence, type RuleDraft, type RuleFieldErrors } from './policyDraft';

export interface PolicyRuleRowProps {
  rule: RuleDraft;
  /** 1-based position among the rules of the same signal. */
  position: number;
  total: number;
  errors: RuleFieldErrors;
  disabled?: boolean;
  onChange: (patch: Partial<RuleDraft>) => void;
  onMove: (direction: 'up' | 'down') => void;
  onRemove: () => void;
}

const ACTION_OPTIONS = POLICY_ACTIONS.map((action) => ({ value: action, label: ACTION_LABELS[action] }));
const VPN_OPTIONS: ReadonlyArray<{ value: MinVpnConfidence; label: string }> = [
  { value: 'possible', label: 'Possible or higher' },
  { value: 'likely', label: 'Likely or higher' },
  { value: 'confirmed', label: 'Confirmed only' },
];
const ALT_OPTIONS: ReadonlyArray<{ value: MinAltConfidence; label: string }> = [
  { value: 'low', label: 'Low or higher' },
  { value: 'medium', label: 'Medium or higher' },
  { value: 'high', label: 'High only' },
];

const ACTION_HINTS: Readonly<Record<PolicyAction, string>> = {
  allow: 'Nothing happens; useful to document a decision.',
  admin_notify: 'Online staff are notified; the player is let in.',
  warn: 'The player sees the message; staff are notified if configured.',
  require_review: 'The player is let in; staff get a persistent review notice.',
  require_whitelist: 'The player is kicked with the message unless a matching bypass exists.',
  kick: 'The player is kicked with the message.',
  ban: 'The player receives a local ban for the given duration (0 = permanent).',
};

function ArrowIcon({ direction }: { direction: 'up' | 'down' }) {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      {direction === 'up' ? <path d="M10 15V5M5 10l5-5 5 5" strokeLinecap="round" strokeLinejoin="round" /> : <path d="M10 5v10M5 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />}
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M4 6h12M8 6V4h4v2M6 6l1 10h6l1-10" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StatusesField({ rule, error, disabled, onChange }: { rule: RuleDraft; error: string | undefined; disabled: boolean; onChange: (statuses: GlobalStatus[]) => void }) {
  const groupId = useId();
  const toggle = (status: GlobalStatus, checked: boolean) => {
    const next = checked ? [...rule.statuses, status] : rule.statuses.filter((value) => value !== status);
    onChange(GLOBAL_STATUSES.filter((value) => next.includes(value)));
  };
  return (
    <fieldset className="field policy-rule-wide" aria-describedby={error !== undefined ? `${groupId}-error` : undefined}>
      <legend className="field-label">Player status is one of</legend>
      <div className="policy-checkgroup">
        {GLOBAL_STATUSES.map((status) => (
          <label key={status}>
            <input type="checkbox" checked={rule.statuses.includes(status)} disabled={disabled} onChange={(event) => toggle(status, event.target.checked)} />
            {humanizeEnum(status)}
          </label>
        ))}
      </div>
      {error !== undefined && (
        <div className="field-error" id={`${groupId}-error`} role="alert">
          {error}
        </div>
      )}
    </fieldset>
  );
}

export function PolicyRuleRow({ rule, position, total, errors, disabled = false, onChange, onMove, onRemove }: PolicyRuleRowProps) {
  const enableId = useId();
  const label = `Rule ${position}`;

  return (
    <div className={['policy-rule', rule.enabled ? '' : 'policy-rule-disabled'].filter(Boolean).join(' ')} role="group" aria-label={label}>
      <div className="policy-rule-head">
        <span className="policy-rule-index">#{position}</span>
        <label className="policy-inline-check" htmlFor={enableId}>
          <input id={enableId} type="checkbox" checked={rule.enabled} disabled={disabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
          Enabled
        </label>
        <div className="policy-rule-tools">
          <IconButton label={`Move ${label} up`} onClick={() => onMove('up')} disabled={disabled || position <= 1}>
            <ArrowIcon direction="up" />
          </IconButton>
          <IconButton label={`Move ${label} down`} onClick={() => onMove('down')} disabled={disabled || position >= total}>
            <ArrowIcon direction="down" />
          </IconButton>
          <IconButton label={`Delete ${label}`} onClick={onRemove} disabled={disabled}>
            <TrashIcon />
          </IconButton>
        </div>
      </div>

      <div className="policy-rule-body">
        {rule.signal === 'global_verdict' && (
          <>
            <StatusesField rule={rule} error={errors.statuses} disabled={disabled} onChange={(statuses) => onChange({ statuses })} />
            <Input
              label="Min. confirming servers (optional)"
              type="number"
              inputMode="numeric"
              min={0}
              max={LIMITS.POLICY_MAX_CONFIRMED_SERVERS}
              value={rule.min_confirmed_servers}
              disabled={disabled}
              error={errors.min_confirmed_servers}
              onChange={(event) => onChange({ min_confirmed_servers: event.target.value })}
            />
          </>
        )}
        {rule.signal === 'account_age' && (
          <>
            <Input
              label="Account younger than (days)"
              type="number"
              inputMode="numeric"
              min={1}
              max={LIMITS.POLICY_MAX_ACCOUNT_AGE_DAYS}
              value={rule.max_account_age_days}
              disabled={disabled}
              error={errors.max_account_age_days}
              onChange={(event) => onChange({ max_account_age_days: event.target.value })}
            />
            <label className="policy-inline-check" style={{ alignSelf: 'end' }}>
              <input type="checkbox" checked={rule.match_unknown_age} disabled={disabled} onChange={(event) => onChange({ match_unknown_age: event.target.checked })} />
              Also match unknown age
            </label>
          </>
        )}
        {rule.signal === 'vpn' && (
          <Select
            label="Min. VPN confidence"
            options={VPN_OPTIONS}
            value={rule.min_vpn_confidence}
            disabled={disabled}
            error={errors.min_vpn_confidence}
            onChange={(event) => onChange({ min_vpn_confidence: event.target.value as MinVpnConfidence })}
          />
        )}
        {rule.signal === 'alt_account' && (
          <>
            <Select
              label="Min. alt confidence"
              options={ALT_OPTIONS}
              value={rule.min_alt_confidence}
              disabled={disabled}
              error={errors.min_alt_confidence}
              onChange={(event) => onChange({ min_alt_confidence: event.target.value as MinAltConfidence })}
            />
            <label className="policy-inline-check" style={{ alignSelf: 'end' }}>
              <input
                type="checkbox"
                checked={rule.require_linked_confirmed_case}
                disabled={disabled}
                onChange={(event) => onChange({ require_linked_confirmed_case: event.target.checked })}
              />
              Only with a linked confirmed case
            </label>
          </>
        )}
        {rule.signal === 'open_reports' && (
          <Input
            label="Min. open reports"
            type="number"
            inputMode="numeric"
            min={1}
            max={LIMITS.POLICY_MAX_OPEN_REPORTS}
            value={rule.min_open_reports}
            disabled={disabled}
            error={errors.min_open_reports}
            onChange={(event) => onChange({ min_open_reports: event.target.value })}
          />
        )}

        <Select
          label="Action"
          options={ACTION_OPTIONS}
          value={rule.action}
          disabled={disabled}
          error={errors.action}
          hint={ACTION_HINTS[rule.action]}
          onChange={(event) => onChange({ action: event.target.value as PolicyAction })}
        />
        {rule.action === 'ban' && (
          <Input
            label="Ban duration (minutes)"
            type="number"
            inputMode="numeric"
            min={0}
            max={LIMITS.POLICY_MAX_BAN_DURATION_MINUTES}
            value={rule.ban_duration_minutes}
            disabled={disabled}
            error={errors.ban_duration_minutes}
            hint="0 or empty = permanent (subject to the plugin's max_ban_duration_minutes)"
            onChange={(event) => onChange({ ban_duration_minutes: event.target.value })}
          />
        )}
        <Input
          label="Message (optional)"
          fieldClassName="policy-rule-wide"
          maxLength={LIMITS.POLICY_MESSAGE_MAX}
          value={rule.message}
          disabled={disabled}
          error={errors.message}
          placeholder="Default text for the action is used when empty"
          hint={
            <span className="policy-placeholders">
              Placeholders:{' '}
              {POLICY_MESSAGE_PLACEHOLDERS.map((name) => (
                <span key={name}>
                  <code>{`{${name}}`}</code>{' '}
                </span>
              ))}
            </span>
          }
          onChange={(event) => onChange({ message: event.target.value })}
        />
      </div>
    </div>
  );
}
