import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { AUDIT_ACTIONS } from '@scpsl-trust/shared';

import { STATUS_KIND_VALUES, StatusBadge, auditActionTone, humanizeEnum, statusTone, type StatusKind } from '../src/components/StatusBadge';

const TONES = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent', 'muted']);

describe('StatusBadge', () => {
  const kinds = Object.keys(STATUS_KIND_VALUES) as StatusKind[];

  it('covers at least one value per kind', () => {
    for (const kind of kinds) expect(STATUS_KIND_VALUES[kind].length).toBeGreaterThan(0);
  });

  it.each(kinds)('renders every value of %s with a tone and a label', (kind) => {
    for (const value of STATUS_KIND_VALUES[kind]) {
      const tone = statusTone(kind, value);
      expect(TONES.has(tone)).toBe(true);
      const { container, unmount } = render(<StatusBadge kind={kind} value={value} />);
      const badge = container.querySelector('.badge');
      expect(badge).not.toBeNull();
      expect(badge?.classList.contains(`badge-${tone}`)).toBe(true);
      expect(badge?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      unmount();
    }
  });

  it('maps every audit action to a tone', () => {
    for (const action of AUDIT_ACTIONS) expect(TONES.has(auditActionTone(action))).toBe(true);
    expect(auditActionTone('USER_LOGIN_FAILED')).toBe('danger');
    expect(auditActionTone('CASE_CREATED')).toBe('success');
    expect(auditActionTone('VERDICT_CHANGED')).toBe('warning');
  });

  it('falls back to neutral for unknown values', () => {
    expect(statusTone('verdict', 'something_new')).toBe('neutral');
  });

  it('humanizes enum values', () => {
    expect(humanizeEnum('under_review')).toBe('Under review');
    expect(humanizeEnum('USER_2FA_ENABLED')).toBe('User 2FA enabled');
    expect(humanizeEnum('vpn_whitelist')).toBe('VPN whitelist');
    expect(humanizeEnum('network_is_vpn')).toBe('Network is VPN');
  });

  it('uses the explicit label when given', () => {
    const { getByText } = render(<StatusBadge kind="caseStatus" value="open" label="Open case" />);
    expect(getByText('Open case')).toBeInTheDocument();
  });
});
