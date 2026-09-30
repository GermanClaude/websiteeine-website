import { randomBytes } from 'node:crypto';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { ConfigError, loadConfig } from '../../src/config';
import { assessSecret, estimateEntropyBits, secretMaterialBytes } from '../../src/lib/secret-strength';

const strong = () => randomBytes(32).toString('base64url');

function productionEnv(overrides: Record<string, string | undefined> = {}): Record<string, string | undefined> {
  return {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgres://app:pw@db:5432/scpsl_trust',
    REDIS_URL: 'redis://redis:6379',
    PUBLIC_BASE_URL: 'https://api.trust.example.org',
    WEB_ORIGIN: 'https://trust.example.org',
    JWT_SECRET: strong(),
    SESSION_SECRET: strong(),
    IP_HASH_SECRET: strong(),
    DATA_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    SMTP_URL: 'smtps://mailer:pw@mail.example.org:465',
    MAIL_FROM: 'Trust Network <no-reply@trust.example.org>',
    ...overrides,
  };
}

function configErrors(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return [...err.issues];
    throw err;
  }
  return [];
}

describe('loadConfig', () => {
  it('applies documented defaults in development and generates ephemeral secrets loudly', () => {
    const config = loadConfig({}, { cwd: '/srv/app' });
    expect(config).toMatchObject({
      nodeEnv: 'development',
      http: { host: '0.0.0.0', port: 3000, publicBaseUrl: 'http://localhost:3000', webOrigin: 'http://localhost:5173', trustProxy: false },
      database: { url: 'postgres://scpsl:scpsl@localhost:5432/scpsl_trust', poolMax: 10, autoMigrate: false },
      redis: { url: null, keyPrefix: 'stn:' },
      cookies: { secure: true },
      session: { ttlHours: 168, idleTimeoutMinutes: 720 },
      auth: {
        emailVerificationRequired: true,
        allowRegistration: true,
        require2faRoles: ['reviewer', 'moderator', 'admin', 'super_admin'],
        loginMaxFailures: 5,
      },
      mail: { transport: 'file', fileDir: path.resolve('/srv/app', '.data/mail') },
      storage: { driver: 'local', localDir: path.resolve('/srv/app', '.data/evidence'), region: 'us-east-1' },
      evidence: {
        maxBytes: 524_288_000,
        nonStaffMaxBytes: 209_715_200,
        uploadsPerHour: 60,
        nonStaffUploadsPerHour: 10,
        nonStaffDailyBytes: 1_073_741_824,
      },
      serverAuth: { signatureMaxSkewSeconds: 60, keyRotationGraceSeconds: 600, registrationTokenTtlHours: 24 },
      vpn: { providers: ['noop'], cidrConfidence: 'likely', providerTimeoutMs: 1500, cacheTtlSeconds: 21_600 },
      accountAge: { cacheDays: 7 },
      alt: { lookbackDays: 30, maxSharedAccounts: 4 },
      overwatch: { intervalSeconds: 10, heartbeatTimeoutSeconds: 90 },
      proof: { rateLimitPerMinute: 20 },
      whitelist: { requestTtlDays: 14 },
      retention: { networkObservationsDays: 30, playerSignalsDays: 90, sessionsDays: 30, overwatchSecretsDays: 365 },
      jobs: { enabled: true },
      features: { publicCaseLookup: true, openapiUi: true },
      logging: { level: 'info', clientIp: false },
      rateLimit: { enabled: true, globalPerMinute: 300, pluginPerMinute: 600, authPerMinute: 10, reportsPerHour: 10 },
    });
    expect(config.secrets.dataEncryptionKey).toHaveLength(32);
    expect(config.secrets.sessionSecret).not.toBe(config.secrets.jwtSecret);
    const warnings = config.warnings.join('\n');
    for (const name of ['JWT_SECRET', 'SESSION_SECRET', 'IP_HASH_SECRET', 'DATA_ENCRYPTION_KEY', 'REDIS_URL']) {
      expect(warnings).toContain(name);
    }
    expect(warnings).toMatch(/EPHEMERAL/);
  });

  it('generates secrets silently in test mode', () => {
    const config = loadConfig({ NODE_ENV: 'test' });
    expect(config.warnings).toEqual([]);
    expect(config.mail.transport).toBe('noop');
  });

  it('accepts a complete production configuration', () => {
    const config = loadConfig(productionEnv());
    expect(config.isProduction).toBe(true);
    expect(config.features.openapiUi).toBe(false);
    expect(config.mail.transport).toBe('smtp');
    expect(config.warnings).toEqual([]);
    expect(Object.isFrozen(config)).toBe(true);
    expect(Object.isFrozen(config.http)).toBe(true);
  });

  it('refuses missing secrets and infrastructure settings in production', () => {
    const errors = configErrors({ NODE_ENV: 'production' });
    for (const name of [
      'JWT_SECRET',
      'SESSION_SECRET',
      'IP_HASH_SECRET',
      'DATA_ENCRYPTION_KEY',
      'REDIS_URL',
      'DATABASE_URL',
      'PUBLIC_BASE_URL',
      'WEB_ORIGIN',
      'SMTP_URL',
    ]) {
      expect(errors.some((error) => error.startsWith(name)), name).toBe(true);
    }
  });

  it.each([
    ['placeholder', 'changeme-changeme-changeme-changeme-please'],
    ['short', 'Zx8#kQ2!'],
    ['repetitive', 'a'.repeat(64)],
    ['low entropy', 'abababababababababababababababababababababab'],
    ['word secret', 'my-super-secret-value-for-production-deploy-2026'],
  ])('refuses a weak SESSION_SECRET in production (%s) without echoing it', (_name, value) => {
    const errors = configErrors(productionEnv({ SESSION_SECRET: value }));
    expect(errors.some((error) => error.startsWith('SESSION_SECRET is weak'))).toBe(true);
    expect(errors.join('\n')).not.toContain(value);
  });

  it('only warns about weak secrets in development', () => {
    const config = loadConfig({ SESSION_SECRET: 'changeme' });
    expect(config.secrets.sessionSecret).toBe('changeme');
    expect(config.warnings.some((w) => w.startsWith('SESSION_SECRET is weak'))).toBe(true);
  });

  it.each([
    ['not base64', 'this is not base64!!'],
    ['16 bytes', randomBytes(16).toString('base64')],
    ['33 bytes', randomBytes(33).toString('base64')],
    ['all zero', Buffer.alloc(32).toString('base64')],
  ])('refuses DATA_ENCRYPTION_KEY: %s', (_name, value) => {
    expect(configErrors(productionEnv({ DATA_ENCRYPTION_KEY: value })).some((e) => e.startsWith('DATA_ENCRYPTION_KEY'))).toBe(true);
  });

  it('accepts url-safe base64 for DATA_ENCRYPTION_KEY', () => {
    const key = randomBytes(32);
    const config = loadConfig(productionEnv({ DATA_ENCRYPTION_KEY: key.toString('base64url') }));
    expect(config.secrets.dataEncryptionKey.equals(key)).toBe(true);
  });

  it('refuses reused secrets in production', () => {
    const shared = strong();
    const errors = configErrors(productionEnv({ SESSION_SECRET: shared, JWT_SECRET: shared }));
    expect(errors).toContain('JWT_SECRET and SESSION_SECRET must be different secrets');
  });

  it.each([
    ['PORT', 'abc'],
    ['PORT', '70000'],
    ['PORT', '1.5'],
    ['COOKIE_SECURE', 'maybe'],
    ['REQUIRE_2FA_ROLES', 'reviewer,god'],
    ['VPN_PROVIDERS', 'noop,magic'],
    ['NODE_ENV', 'staging'],
    ['LOG_LEVEL', 'verbose'],
    ['DATABASE_URL', 'mysql://x'],
    ['REDIS_URL', 'http://redis'],
    ['SIGNATURE_MAX_SKEW_SECONDS', '0'],
    ['OVERWATCH_INTERVAL_SECONDS', '61'],
    ['STORAGE_DRIVER', 'ftp'],
    ['REDIS_KEY_PREFIX', 'bad prefix'],
  ])('rejects invalid %s=%s', (name, value) => {
    const errors = configErrors({ [name]: value });
    expect(errors.some((error) => error.startsWith(name)), errors.join('\n')).toBe(true);
  });

  it('treats empty values as unset', () => {
    const config = loadConfig({ PORT: '', COOKIE_SECURE: '  ', REDIS_URL: '' });
    expect(config.http.port).toBe(3000);
    expect(config.cookies.secure).toBe(true);
    expect(config.redis.url).toBeNull();
  });

  it('parses lists and booleans', () => {
    const config = loadConfig({
      REQUIRE_2FA_ROLES: ' admin , super_admin,admin ',
      VPN_PROVIDERS: 'cidr-list, proxycheck',
      VPN_CIDR_LIST_PATHS: '/etc/vpn/a.txt, relative/b.txt',
      COOKIE_SECURE: 'false',
      JOBS_ENABLED: 'off',
      OPENAPI_UI: 'yes',
    });
    expect(config.auth.require2faRoles).toEqual(['admin', 'super_admin']);
    expect(config.vpn.providers).toEqual(['cidr-list', 'proxycheck']);
    expect(config.vpn.cidrListPaths).toEqual(['/etc/vpn/a.txt', path.resolve('relative/b.txt')]);
    expect(config.cookies.secure).toBe(false);
    expect(config.jobs.enabled).toBe(false);
    expect(config.features.openapiUi).toBe(true);
    expect(loadConfig({ REQUIRE_2FA_ROLES: 'none' }).auth.require2faRoles).toEqual([]);
  });

  it.each([
    ['true', true],
    ['false', false],
    ['2', 2],
    ['10.0.0.0/8, 127.0.0.1, loopback', ['10.0.0.0/8', '127.0.0.1', 'loopback']],
  ])('parses TRUST_PROXY=%s', (value, expected) => {
    expect(loadConfig({ TRUST_PROXY: value }).http.trustProxy).toEqual(expected);
  });

  it.each(['11', '10.0.0.0/99', 'proxy.example.org'])('rejects TRUST_PROXY=%s', (value) => {
    expect(configErrors({ TRUST_PROXY: value }).some((e) => e.startsWith('TRUST_PROXY'))).toBe(true);
  });

  it('validates cross-field requirements', () => {
    expect(configErrors({ WEB_ORIGIN: 'https://trust.example.org/app' }).some((e) => e.startsWith('WEB_ORIGIN'))).toBe(true);
    expect(configErrors({ STORAGE_DRIVER: 's3' })).toContain('STORAGE_BUCKET is required when STORAGE_DRIVER=s3');
    expect(configErrors({ STORAGE_DRIVER: 's3', STORAGE_BUCKET: 'evidence', STORAGE_ACCESS_KEY: 'AKIA' })).toContain(
      'STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY must be set together',
    );
    expect(configErrors({ VPN_PROVIDERS: 'cidr-list' })).toContain('VPN_CIDR_LIST_PATHS is required when VPN_PROVIDERS contains cidr-list');
    expect(configErrors({ VPN_PROVIDERS: 'iphub' })).toContain('IPHUB_API_KEY is required when VPN_PROVIDERS contains iphub');
    expect(configErrors({ MAIL_TRANSPORT: 'smtp' })).toContain('SMTP_URL is required when MAIL_TRANSPORT=smtp');
    expect(configErrors(productionEnv({ MAIL_TRANSPORT: 'file' }))).toContain('MAIL_TRANSPORT=file is for development only');
    expect(loadConfig(productionEnv({ COOKIE_SECURE: 'false' })).warnings.join()).toContain('COOKIE_SECURE=false');
  });

  it('normalizes WEB_ORIGIN and PUBLIC_BASE_URL', () => {
    const config = loadConfig({ WEB_ORIGIN: 'https://Trust.Example.org/', PUBLIC_BASE_URL: 'https://api.example.org/base/' });
    expect(config.http.webOrigin).toBe('https://trust.example.org');
    expect(config.http.publicBaseUrl).toBe('https://api.example.org/base');
  });
});

describe('secret strength heuristics', () => {
  it('measures key material of hex, base64 and plain strings', () => {
    expect(secretMaterialBytes(randomBytes(32).toString('hex'))).toBe(32);
    expect(secretMaterialBytes(randomBytes(32).toString('base64'))).toBe(32);
    expect(secretMaterialBytes(randomBytes(32).toString('base64url'))).toBe(32);
    expect(secretMaterialBytes('ä'.repeat(16))).toBe(32);
  });

  it('accepts generated secrets and estimates entropy', () => {
    for (let i = 0; i < 50; i += 1) {
      expect(assessSecret(randomBytes(32).toString('base64'))).toEqual([]);
      expect(assessSecret(randomBytes(32).toString('hex'))).toEqual([]);
    }
    expect(estimateEntropyBits('')).toBe(0);
    expect(estimateEntropyBits('aaaa')).toBe(0);
  });
});
