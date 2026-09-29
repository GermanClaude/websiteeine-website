/**
 * Fixtures for the servers / whitelist / appeals / admin page tests.
 */
import type { AdminUser, AppealView, ServerPolicyView, ServerView, WhitelistRequestView } from '@scpsl-trust/shared';

import { USER_ID } from './helpers';

export const SERVER_ID = 'srv_7k4x92m8pq174kf9';
export const REGISTRATION_TOKEN = 'sreg_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
export const APPEAL_ID = '9d1e2c3b-4a5f-4b6c-8d7e-9f0a1b2c3d4e';
export const REQUEST_ID = '1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d';

export function fakeServer(overrides: Partial<ServerView> = {}): ServerView {
  return {
    server_id: SERVER_ID,
    name: 'Alpha EU #1',
    status: 'pending',
    is_trusted: false,
    key_fingerprint: null,
    plugin_version: null,
    last_seen_at: null,
    member_role: 'owner',
    description: null,
    owner: { id: USER_ID, username: 'testuser' },
    accepts_whitelist_requests: true,
    game_version: null,
    registered_at: null,
    key_rotation_requested_at: null,
    policy_version: null,
    created_at: '2026-09-29T10:00:00.000Z',
    updated_at: '2026-09-29T10:00:00.000Z',
    ...overrides,
  };
}

export function fakePolicy(overrides: Partial<ServerPolicyView> = {}): ServerPolicyView {
  return {
    id: '5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f',
    server_id: SERVER_ID,
    version: 1,
    is_active: true,
    backend_unavailable_action: 'allow',
    notify_on_enforcement: true,
    honor_global_bypasses: false,
    whitelist_url: null,
    rules: [
      {
        id: 'default-global-verdict',
        enabled: true,
        signal: 'global_verdict',
        action: 'admin_notify',
        statuses: ['confirmed'],
        min_confirmed_servers: null,
        message: null,
        ban_duration_minutes: null,
      },
      {
        id: 'default-account-age',
        enabled: true,
        signal: 'account_age',
        action: 'admin_notify',
        max_account_age_days: 3,
        match_unknown_age: false,
        message: null,
        ban_duration_minutes: null,
      },
    ],
    created_at: '2026-09-29T10:00:00.000Z',
    created_by: null,
    ...overrides,
  };
}

export function fakeWhitelistRequest(overrides: Partial<WhitelistRequestView> = {}): WhitelistRequestView {
  return {
    id: REQUEST_ID,
    player: { user_id: '76561198000000001@steam', type: 'steam', id: '76561198000000001', display_name: 'Foo' },
    requester: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', username: 'foo' },
    server: { server_id: SERVER_ID, name: 'Alpha EU #1', is_trusted: false },
    type: 'vpn_whitelist',
    reason: 'I play from a university network that is flagged as hosting.',
    requested_days: 30,
    status: 'pending',
    decided_by: null,
    decided_at: null,
    decision_note: null,
    bypass_id: null,
    bypass_expires_at: null,
    expires_at: '2026-10-13T10:00:00.000Z',
    created_at: '2026-09-29T10:00:00.000Z',
    updated_at: '2026-09-29T10:00:00.000Z',
    ...overrides,
  };
}

export function fakeAppeal(overrides: Partial<AppealView> = {}): AppealView {
  return {
    id: APPEAL_ID,
    case_number: 'CASE-2026-001337',
    player: { user_id: '76561198000000001@steam', type: 'steam', id: '76561198000000001', display_name: 'Foo' },
    submitted_by: { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', username: 'foo' },
    statement: 'I did not cheat. The video shows a legitimate flick shot.',
    status: 'open',
    assigned_reviewer: null,
    decision: null,
    decision_reason: null,
    decided_by: null,
    decided_at: null,
    conflict_override: false,
    created_at: '2026-09-29T10:00:00.000Z',
    updated_at: '2026-09-29T10:00:00.000Z',
    ...overrides,
  };
}

export function fakeAdminUser(overrides: Partial<AdminUser> = {}): AdminUser {
  return {
    id: 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff',
    email: 'someone@example.org',
    username: 'someone',
    role: 'player',
    status: 'active',
    email_verified_at: '2026-09-01T00:00:00.000Z',
    mfa_enabled: false,
    reviewer_number: null,
    locked_until: null,
    last_login_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    linked_player: null,
    ...overrides,
  };
}
