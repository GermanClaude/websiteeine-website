import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { ServerPolicySchema, ServerPolicyUpdateRequestSchema, evaluatePolicy, type ServerPolicyUpdateRequestInput } from '@scpsl-trust/shared';

import { PolicyEditor } from '../src/pages/servers/policy/PolicyEditor';
import { DEFAULT_SAMPLE, sampleToInput } from '../src/pages/servers/policy/PolicyPreview';
import { addRule, draftFromPolicy, draftToWire, newRuleDraft, updateRule, validateDraft } from '../src/pages/servers/policy/policyDraft';
import { fakePolicy } from './area-fixtures';
import { renderWithProviders } from './helpers';

describe('policy draft', () => {
  it('produces a policy accepted by the shared ServerPolicySchema', () => {
    const draft = draftFromPolicy(fakePolicy());
    const result = validateDraft(draft, 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(ServerPolicySchema.safeParse(draftToWire(draft, 1)).success).toBe(true);
    expect(ServerPolicyUpdateRequestSchema.safeParse(result.request).success).toBe(true);
    expect(result.request.base_version).toBe(1);
    // Only the rule's own condition fields are sent.
    const accountAge = result.policy.rules.find((rule) => rule.signal === 'account_age');
    expect(accountAge).toMatchObject({ max_account_age_days: 3, match_unknown_age: false });
    expect(accountAge).not.toHaveProperty('min_vpn_confidence', expect.anything());
  });

  it('rejects invalid rows and reports the field per rule', () => {
    let draft = draftFromPolicy(fakePolicy());
    draft = addRule(draft, 'vpn');
    const vpnRule = draft.rules.find((rule) => rule.signal === 'vpn');
    expect(vpnRule).toBeDefined();
    const accountAgeRule = draft.rules.find((rule) => rule.signal === 'account_age');
    expect(accountAgeRule).toBeDefined();
    if (vpnRule === undefined || accountAgeRule === undefined) return;

    draft = updateRule(draft, accountAgeRule.key, { max_account_age_days: 'abc' });
    const globalRule = draft.rules.find((rule) => rule.signal === 'global_verdict');
    if (globalRule === undefined) return;
    draft = updateRule(draft, globalRule.key, { statuses: [] });

    const result = validateDraft(draft, 1);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.rules[accountAgeRule.key]?.max_account_age_days).toBe('Enter a whole number');
    expect(result.errors.rules[globalRule.key]?.statuses).toBe('Select at least one status');
    expect(result.errors.rules[vpnRule.key]).toBeUndefined();
  });

  it('rejects an invalid whitelist URL and too many rules', () => {
    let draft = draftFromPolicy(fakePolicy());
    draft = { ...draft, whitelist_url: 'not a url' };
    const invalidUrl = validateDraft(draft, 1);
    expect(invalidUrl.ok).toBe(false);
    if (!invalidUrl.ok) expect(invalidUrl.errors.settings.whitelist_url).toBeDefined();

    let many = draftFromPolicy(fakePolicy({ rules: [] }));
    for (let i = 0; i < 51; i += 1) many = addRule(many, 'open_reports');
    const tooMany = validateDraft(many, 1);
    expect(tooMany.ok).toBe(false);
    if (!tooMany.ok) expect(tooMany.errors.form.length).toBeGreaterThan(0);
  });

  it('only sends a ban duration for ban rules', () => {
    const rule = { ...newRuleDraft('open_reports'), action: 'kick' as const, ban_duration_minutes: '30' };
    const draft = { ...draftFromPolicy(fakePolicy({ rules: [] })), rules: [rule] };
    const result = validateDraft(draft, 1);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.policy.rules[0]?.ban_duration_minutes).toBeNull();
    const ban = validateDraft({ ...draft, rules: [{ ...rule, action: 'ban', ban_duration_minutes: '' }] }, 1);
    expect(ban.ok).toBe(true);
    if (ban.ok) expect(ban.policy.rules[0]?.ban_duration_minutes).toBe(0);
  });
});

describe('policy preview', () => {
  it('evaluates the draft with the shared engine (account age 3 days with < 7 → kick)', () => {
    let draft = draftFromPolicy(fakePolicy({ rules: [] }));
    draft = addRule(draft, 'account_age');
    const rule = draft.rules[0];
    if (rule === undefined) throw new Error('rule missing');
    draft = updateRule(draft, rule.key, { max_account_age_days: '7', action: 'kick', message: 'Account too young ({days} days) on {server_name}' });
    const validated = validateDraft(draft, 1);
    expect(validated.ok).toBe(true);
    if (!validated.ok) return;

    const input = sampleToInput({ ...DEFAULT_SAMPLE, account_age_days: '3' });
    const decision = evaluatePolicy(input, validated.policy, { server_name: 'Alpha' });
    expect(decision.action).toBe('kick');
    expect(decision.message).toBe('Account too young (3 days) on Alpha');
    expect(decision.applied.map((outcome) => outcome.reason_code)).toEqual(['account_age_below_threshold']);

    const older = evaluatePolicy(sampleToInput({ ...DEFAULT_SAMPLE, account_age_days: '30' }), validated.policy);
    expect(older.action).toBe('allow');

    const bypassed = evaluatePolicy(sampleToInput({ ...DEFAULT_SAMPLE, account_age_days: '3', bypass_types: ['account_age_whitelist'] }), validated.policy);
    expect(bypassed.action).toBe('allow');
    expect(bypassed.bypassed).toHaveLength(1);
  });
});

describe('PolicyEditor', () => {
  it('blocks saving invalid rows and saves a valid policy as a new version', async () => {
    const onSave = vi.fn(async (_request: ServerPolicyUpdateRequestInput) => undefined);
    renderWithProviders(<PolicyEditor serverId="srv_7k4x92m8pq174kf9" serverName="Alpha" policy={fakePolicy()} onSave={onSave} saving={false} saveError={null} />);
    const user = userEvent.setup();

    expect(screen.getAllByText('The backend never enforces — this server decides.').length).toBeGreaterThan(0);

    const accountAgeSection = screen.getByRole('region', { name: /account age/i });
    const daysInput = within(accountAgeSection).getByLabelText(/Account younger than/i);
    await user.clear(daysInput);
    await user.type(daysInput, 'x');
    await user.click(screen.getByRole('button', { name: /Save as version 2/ }));
    expect(await screen.findByText('Enter a whole number')).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();

    await user.clear(daysInput);
    await user.type(daysInput, '7');
    await user.selectOptions(within(accountAgeSection).getByLabelText('Action'), 'kick');
    await user.click(screen.getByRole('button', { name: /Save as version 2/ }));
    expect(onSave).toHaveBeenCalledTimes(1);
    const request = onSave.mock.calls[0]?.[0];
    expect(ServerPolicyUpdateRequestSchema.safeParse(request).success).toBe(true);
    expect(request).toMatchObject({ base_version: 1, rules: [expect.objectContaining({ signal: 'global_verdict' }), expect.objectContaining({ signal: 'account_age', action: 'kick', max_account_age_days: 7 })] });

    // The preview reflects the draft: a 3-day-old account is now kicked (30 days: allowed).
    const preview = screen.getByText('Client-side (shared engine, current draft)').closest('.card');
    expect(preview).not.toBeNull();
    if (preview === null) return;
    expect(within(preview as HTMLElement).getAllByText('Allow').length).toBeGreaterThan(0);
    const ageInput = screen.getByLabelText('Account age (days)');
    await user.clear(ageInput);
    await user.type(ageInput, '3');
    expect(within(preview as HTMLElement).getAllByText('Kick').length).toBeGreaterThan(0);
    expect(within(preview as HTMLElement).getByText('Account age below threshold')).toBeInTheDocument();
  });
});
