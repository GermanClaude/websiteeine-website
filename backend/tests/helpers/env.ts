/**
 * Environment for test configurations. Secrets are random per test process; limits are
 * raised so functional tests are not throttled (tests of rate limits set them explicitly).
 */
import { randomBytes } from 'node:crypto';

const PROCESS_SECRETS = Object.freeze({
  JWT_SECRET: randomBytes(32).toString('base64url'),
  SESSION_SECRET: randomBytes(32).toString('base64url'),
  IP_HASH_SECRET: randomBytes(32).toString('base64url'),
  DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
});

export const TEST_WEB_ORIGIN = 'http://localhost:5173';
export const TEST_PUBLIC_BASE_URL = 'http://localhost:3000';

export function testEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    PUBLIC_BASE_URL: TEST_PUBLIC_BASE_URL,
    WEB_ORIGIN: TEST_WEB_ORIGIN,
    COOKIE_SECURE: 'true',
    MAIL_TRANSPORT: 'noop',
    JOBS_ENABLED: 'false',
    OPENAPI_UI: 'false',
    RATE_LIMIT_GLOBAL_PER_MINUTE: '100000',
    RATE_LIMIT_PLUGIN_PER_MINUTE: '100000',
    RATE_LIMIT_AUTH_PER_MINUTE: '100000',
    RATE_LIMIT_REPORTS_PER_HOUR: '100000',
    RATE_LIMIT_SERVER_AUTH_FAILURES_PER_MINUTE: '100000',
    PROOF_RATE_LIMIT_PER_MINUTE: '100000',
    // Intrusion detection is off by default in tests (like the raised rate limits) so repeated
    // failures in functional tests are not auto-blocked; the security tests enable it explicitly.
    SECURITY_DETECTION_ENABLED: 'false',
    ...PROCESS_SECRETS,
    ...overrides,
  };
}
