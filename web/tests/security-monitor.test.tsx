import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  Permission,
  SECURITY_SEVERITIES,
  type SecurityBlockListResponse,
  type SecurityEventListResponse,
  type SecuritySummaryResponse,
} from '@scpsl-trust/shared';

import { resetClientState } from '../src/api/client';
import { SeverityBadge, severityTone, SEVERITY_TONES } from '../src/pages/admin/security/SeverityBadge';
import SecurityMonitorPage from '../src/pages/admin/security/SecurityMonitorPage';
import { fakeMe, fakeSession, jsonResponse, mockFetch, renderWithProviders, type RecordedCall } from './helpers';

const SUMMARY: SecuritySummaryResponse = {
  events_last_24h: { info: 3, low: 5, medium: 2, high: 1, critical: 1 },
  total_events_last_24h: 12,
  anomalies_last_24h: 2,
  active_blocks: 1,
  top_sources: [{ source_type: 'network', source_ref: 'a'.repeat(64), event_count: 7, max_severity: 'high' }],
  detection_enabled: true,
  anomaly_enabled: true,
  generated_at: '2026-10-01T10:00:00.000Z',
};

function eventsResponse(overrides: Partial<SecurityEventListResponse> = {}): SecurityEventListResponse {
  return {
    items: [
      {
        id: '11111111-1111-4111-8111-111111111111',
        created_at: '2026-10-01T09:59:00.000Z',
        kind: 'auth_failure_burst',
        severity: 'high',
        source_type: 'network',
        source_ref: 'a'.repeat(64),
        score: 120,
        action_taken: 'blocked',
        endpoint: 'POST /api/v1/auth/login',
        request_id: 'abcdef12-3456-7890-abcd-ef1234567890',
        metadata: { attempts: 40 },
        expires_at: '2026-10-01T10:15:00.000Z',
      },
    ],
    page: 1,
    page_size: 25,
    total: 1,
    ...overrides,
  };
}

const ANOMALIES: SecurityEventListResponse = {
  items: [
    {
      id: '22222222-2222-4222-8222-222222222222',
      created_at: '2026-10-01T09:50:00.000Z',
      kind: 'anomaly',
      severity: 'medium',
      source_type: 'user',
      source_ref: '6f1c2f3a-7a3b-4d3e-9a1b-2c3d4e5f6a7b',
      score: null,
      action_taken: 'flagged',
      endpoint: 'GET /api/v1/admin/users',
      request_id: null,
      metadata: { reason: 'Request rate 6x above the recent baseline for this user.' },
      expires_at: null,
    },
  ],
  page: 1,
  page_size: 50,
  total: 1,
};

const BLOCKS: SecurityBlockListResponse = {
  items: [
    {
      id: `network.${'a'.repeat(64)}`,
      source_type: 'network',
      source_ref: 'a'.repeat(64),
      score: 120,
      strikes: 2,
      expires_at: '2026-10-01T10:15:00.000Z',
      ttl_seconds: 540,
    },
  ],
};

interface RouteOptions {
  permissions?: Permission[];
  onClear?: (call: RecordedCall) => void;
}

function installRoutes({ permissions, onClear }: RouteOptions = {}) {
  return mockFetch((call) => {
    if (call.url === '/api/v1/auth/session') {
      return jsonResponse(200, permissions === undefined ? fakeSession('admin') : fakeSession('admin', { permissions }));
    }
    if (call.url === '/api/v1/me') return jsonResponse(200, fakeMe('admin'));
    if (call.url === '/api/v1/admin/security/summary') return jsonResponse(200, SUMMARY);
    if (call.url.startsWith('/api/v1/admin/security/events')) {
      if (call.url.includes('kind=anomaly')) return jsonResponse(200, ANOMALIES);
      return jsonResponse(200, eventsResponse());
    }
    if (call.url === '/api/v1/admin/security/blocks') return jsonResponse(200, BLOCKS);
    if (call.url.includes('/clear') && call.method === 'POST') {
      onClear?.(call);
      return jsonResponse(200, { ok: true, cleared: true, source_type: 'network', source_ref: 'a'.repeat(64) });
    }
    return undefined;
  });
}

describe('SeverityBadge', () => {
  afterEach(() => resetClientState());

  it('maps every severity to a known tone and a non-empty label', () => {
    const tones = new Set(['neutral', 'info', 'success', 'warning', 'danger', 'accent', 'muted']);
    for (const severity of SECURITY_SEVERITIES) {
      const tone = severityTone(severity);
      expect(tones.has(tone)).toBe(true);
      expect(SEVERITY_TONES[severity]).toBe(tone);
      const { container, unmount } = render(<SeverityBadge severity={severity} count={3} />);
      const badge = container.querySelector('.badge');
      expect(badge).not.toBeNull();
      expect(badge?.classList.contains(`badge-${tone}`)).toBe(true);
      expect(badge?.textContent?.trim().length ?? 0).toBeGreaterThan(0);
      unmount();
    }
  });

  it('falls back to neutral for an unknown severity', () => {
    expect(severityTone('nonsense')).toBe('neutral');
  });
});

describe('SecurityMonitorPage', () => {
  let restore: () => void = () => undefined;
  beforeEach(() => resetClientState());
  afterEach(() => restore());

  it('renders the 24h summary and the live events table', async () => {
    const mock = installRoutes();
    restore = mock.restore;

    renderWithProviders(<SecurityMonitorPage />, { route: '/admin/security' });

    // Summary strip
    expect(await screen.findByText('Events (last 24h)')).toBeInTheDocument();
    expect(screen.getByText('Detection enabled')).toBeInTheDocument();
    expect(screen.getByText('Anomaly flagging enabled')).toBeInTheDocument();

    // Events table row (endpoint + truncated source ref are unique to the row).
    expect(await screen.findByText('POST /api/v1/auth/login')).toBeInTheDocument();
    // The privacy-preserving source ref is shown truncated, never a raw IP.
    expect(screen.getByText(`${'a'.repeat(20)}…`)).toBeInTheDocument();
    // The event kind renders in the table (and also in the filter dropdown).
    expect(screen.getAllByText('Auth failure burst').length).toBeGreaterThan(0);
  });

  it('hides the Clear block action without security:manage', async () => {
    const mock = installRoutes({ permissions: [Permission.SECURITY_VIEW] });
    restore = mock.restore;

    renderWithProviders(<SecurityMonitorPage />, { route: '/admin/security' });
    await screen.findByText('Events (last 24h)');

    await userEvent.click(screen.getByRole('tab', { name: /Active blocks/ }));

    // The blocks table renders, but no clear button for a view-only admin.
    await waitFor(() => expect(screen.getByText('Remaining')).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: 'Clear block' })).toBeNull();
  });

  it('shows and runs the Clear block action with security:manage', async () => {
    let cleared: RecordedCall | null = null;
    const mock = installRoutes({ onClear: (call) => (cleared = call) });
    restore = mock.restore;

    renderWithProviders(<SecurityMonitorPage />, { route: '/admin/security' });
    await screen.findByText('Events (last 24h)');

    await userEvent.click(screen.getByRole('tab', { name: /Active blocks/ }));
    const clearButton = await screen.findByRole('button', { name: 'Clear block' });
    await userEvent.click(clearButton);

    // In-page confirm dialog (no window.confirm).
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText(/Reason/), 'Confirmed false positive');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Clear block' }));

    await waitFor(() => expect(cleared).not.toBeNull());
    expect(cleared!.url).toContain(`/api/v1/admin/security/blocks/network.${'a'.repeat(64)}/clear`);
    expect(cleared!.body).toEqual({ reason: 'Confirmed false positive' });
  });

  it('syncs an events filter into the query sent to the API', async () => {
    const mock = installRoutes();
    restore = mock.restore;

    renderWithProviders(<SecurityMonitorPage />, { route: '/admin/security' });
    await screen.findByText('Auth failure burst');

    await userEvent.selectOptions(screen.getByLabelText('Severity'), 'high');

    await waitFor(() => {
      const filtered = mock.calls.find((call) => call.url.startsWith('/api/v1/admin/security/events') && call.url.includes('severity=high'));
      expect(filtered).toBeDefined();
    });
  });

  it('frames anomalies as review items, not automatic punishment', async () => {
    const mock = installRoutes();
    restore = mock.restore;

    renderWithProviders(<SecurityMonitorPage />, { route: '/admin/security' });
    await screen.findByText('Events (last 24h)');

    await userEvent.click(screen.getByRole('tab', { name: /Anomalies/ }));

    expect(await screen.findByText('For review — not automatic punishment')).toBeInTheDocument();
    expect(screen.getByText(/Request rate 6x above the recent baseline/)).toBeInTheDocument();
  });
});
