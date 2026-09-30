/**
 * Environment → typed, validated Config (ARCHITECTURE §16; documented in .env.example and
 * docs/CONFIGURATION.md).
 *
 * Secrets: production (NODE_ENV=production) refuses missing or weak secrets. Development
 * and test generate ephemeral random values for missing secrets; development records a
 * loud warning (Config.warnings) because sessions, encrypted TOTP secrets and network
 * hashes do not survive a restart then.
 */
import { randomBytes } from 'node:crypto';
import path from 'node:path';

import ipaddr from 'ipaddr.js';
import { z } from 'zod';

import {
  DEFAULT_EVIDENCE_MAX_BYTES,
  DEFAULT_KEY_ROTATION_GRACE_SECONDS,
  DEFAULT_REQUIRE_2FA_ROLES,
  DEFAULT_SIGNATURE_MAX_SKEW_SECONDS,
  DEFAULTS,
  OVERWATCH_DEFAULT_INTERVAL_SECONDS,
  OVERWATCH_MAX_INTERVAL_SECONDS,
  OVERWATCH_MIN_INTERVAL_SECONDS,
  USER_ROLES,
  type UserRole,
  type VpnConfidence,
} from '@scpsl-trust/shared';

import { envBool, envEnumList, envInt, envOptionalBool, envUrl, normalizeEnv, splitList, type RawEnv } from './lib/env';
import { assessKeyBytes, assessSecret, type SecretWeakness } from './lib/secret-strength';

export const NODE_ENVS = ['development', 'production', 'test'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];
export const MAIL_TRANSPORTS = ['smtp', 'file', 'noop'] as const;
export type MailTransport = (typeof MAIL_TRANSPORTS)[number];
export const STORAGE_DRIVERS = ['local', 's3'] as const;
export type StorageDriver = (typeof STORAGE_DRIVERS)[number];
export const VPN_PROVIDER_NAMES = ['noop', 'cidr-list', 'proxycheck', 'iphub'] as const;
export type VpnProviderName = (typeof VPN_PROVIDER_NAMES)[number];
export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];
/** Confidences a CIDR list match may report (not_detected would be meaningless). */
export const VPN_CIDR_CONFIDENCES = ['possible', 'likely', 'confirmed'] as const;

/** Fastify `trustProxy`: false, true, hop count, or a list of trusted addresses/CIDRs. */
export type TrustProxySetting = boolean | number | string[];

export interface Config {
  readonly nodeEnv: NodeEnv;
  readonly isProduction: boolean;
  readonly isDevelopment: boolean;
  readonly isTest: boolean;
  readonly http: {
    readonly host: string;
    readonly port: number;
    /** Public URL of the API (links in e-mails, OpenAPI servers), without trailing slash. */
    readonly publicBaseUrl: string;
    /** Origin of the web panel (CORS, CSRF Origin check), e.g. https://trust.example.org. */
    readonly webOrigin: string;
    readonly trustProxy: TrustProxySetting;
    readonly shutdownTimeoutMs: number;
  };
  readonly database: {
    readonly url: string;
    readonly poolMax: number;
    readonly statementTimeoutMs: number;
    /** Apply pending migrations at startup. */
    readonly autoMigrate: boolean;
  };
  readonly redis: {
    /** null = no Redis (in-memory stores; single instance only, not allowed in production). */
    readonly url: string | null;
    readonly keyPrefix: string;
  };
  readonly secrets: {
    /** Signs short-lived evidence download tickets (§12.1). */
    readonly jwtSecret: string;
    /** Signs the session cookie and derives CSRF tokens (§12.1). */
    readonly sessionSecret: string;
    /** AES-256-GCM key for secrets at rest (32 bytes). */
    readonly dataEncryptionKey: Buffer;
    /** HMAC key of network hashes (§8.1). */
    readonly ipHashSecret: string;
  };
  readonly cookies: { readonly secure: boolean };
  readonly session: { readonly ttlHours: number; readonly idleTimeoutMinutes: number };
  readonly auth: {
    readonly emailVerificationRequired: boolean;
    readonly allowRegistration: boolean;
    readonly require2faRoles: readonly UserRole[];
    readonly loginMaxFailures: number;
  };
  readonly mail: {
    readonly transport: MailTransport;
    readonly from: string;
    readonly smtpUrl: string | null;
    readonly fileDir: string;
  };
  readonly storage: {
    readonly driver: StorageDriver;
    readonly localDir: string;
    readonly endpoint: string | null;
    readonly region: string;
    readonly bucket: string | null;
    readonly accessKey: string | null;
    readonly secretKey: string | null;
    readonly forcePathStyle: boolean;
  };
  readonly evidence: {
    readonly maxBytes: number;
    /** Per-file cap for uploaders without evidence:upload (reporters, server teams). */
    readonly nonStaffMaxBytes: number;
    /** Uploads (files, links, supersedes) per user and hour: holders of evidence:upload / others. */
    readonly uploadsPerHour: number;
    readonly nonStaffUploadsPerHour: number;
    /** Stored bytes per non-staff user and UTC day. */
    readonly nonStaffDailyBytes: number;
  };
  readonly serverAuth: {
    readonly signatureMaxSkewSeconds: number;
    readonly keyRotationGraceSeconds: number;
    readonly registrationTokenTtlHours: number;
  };
  readonly vpn: {
    readonly providers: readonly VpnProviderName[];
    readonly cidrListPaths: readonly string[];
    readonly cidrConfidence: Exclude<VpnConfidence, 'not_detected'>;
    readonly proxycheckApiKey: string | null;
    readonly iphubApiKey: string | null;
    readonly providerTimeoutMs: number;
    readonly cacheTtlSeconds: number;
  };
  readonly accountAge: { readonly steamWebApiKey: string | null; readonly cacheDays: number };
  readonly alt: { readonly lookbackDays: number; readonly maxSharedAccounts: number };
  readonly overwatch: { readonly intervalSeconds: number; readonly heartbeatTimeoutSeconds: number };
  readonly proof: { readonly rateLimitPerMinute: number };
  readonly whitelist: { readonly requestTtlDays: number };
  readonly retention: {
    readonly networkObservationsDays: number;
    readonly playerSignalsDays: number;
    readonly sessionsDays: number;
    readonly overwatchSecretsDays: number;
  };
  readonly jobs: { readonly enabled: boolean };
  readonly features: { readonly publicCaseLookup: boolean; readonly openapiUi: boolean };
  readonly logging: { readonly level: LogLevel; readonly clientIp: boolean; readonly pretty: boolean };
  readonly rateLimit: {
    readonly enabled: boolean;
    /** Web requests per IP and minute. */
    readonly globalPerMinute: number;
    /** Signed plugin requests per server and minute. */
    readonly pluginPerMinute: number;
    /** Auth endpoints (login, register, reset, 2FA) per IP and minute. */
    readonly authPerMinute: number;
    /** Report creation per user and hour. */
    readonly reportsPerHour: number;
    /** Failed signed-request authentications per (server, IP) and minute before 429. */
    readonly serverAuthFailuresPerMinute: number;
  };
  /** Non-fatal configuration problems; logged loudly at startup. Never contains secret values. */
  readonly warnings: readonly string[];
}

export class ConfigError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super(`Invalid configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.issues = issues;
  }
}

// ---------------------------------------------------------------------------
// Raw schema
// ---------------------------------------------------------------------------

const optionalString = z.string().optional();

const EnvSchema = z.object({
  NODE_ENV: z.enum(NODE_ENVS).default('development'),
  PORT: envInt(3000, 1, 65_535),
  HOST: z.string().default('0.0.0.0'),
  PUBLIC_BASE_URL: envUrl().optional(),
  WEB_ORIGIN: envUrl().optional(),
  TRUST_PROXY: optionalString,
  SHUTDOWN_TIMEOUT_MS: envInt(10_000, 0, 300_000),

  DATABASE_URL: envUrl(['postgres:', 'postgresql:']).optional(),
  DATABASE_POOL_MAX: envInt(10, 1, 200),
  DATABASE_STATEMENT_TIMEOUT_MS: envInt(30_000, 0, 3_600_000),
  AUTO_MIGRATE: envBool(false),

  REDIS_URL: envUrl(['redis:', 'rediss:']).optional(),
  REDIS_KEY_PREFIX: z
    .string()
    .regex(/^[A-Za-z0-9_.:-]{1,32}$/, 'must be 1-32 characters [A-Za-z0-9_.:-]')
    .default('stn:'),

  JWT_SECRET: optionalString,
  SESSION_SECRET: optionalString,
  DATA_ENCRYPTION_KEY: optionalString,
  IP_HASH_SECRET: optionalString,

  COOKIE_SECURE: envBool(true),
  SESSION_TTL_HOURS: envInt(168, 1, 8_760),
  SESSION_IDLE_TIMEOUT_MINUTES: envInt(720, 5, 525_600),
  EMAIL_VERIFICATION_REQUIRED: envBool(true),
  ALLOW_REGISTRATION: envBool(true),
  REQUIRE_2FA_ROLES: envEnumList(USER_ROLES, DEFAULT_REQUIRE_2FA_ROLES),
  LOGIN_MAX_FAILURES: envInt(5, 1, 100),

  MAIL_TRANSPORT: z.enum(MAIL_TRANSPORTS).optional(),
  MAIL_FROM: z.string().max(320).optional(),
  SMTP_URL: envUrl(['smtp:', 'smtps:']).optional(),
  MAIL_FILE_DIR: z.string().default('./.data/mail'),

  STORAGE_DRIVER: z.enum(STORAGE_DRIVERS).default('local'),
  STORAGE_LOCAL_DIR: z.string().default('./.data/evidence'),
  STORAGE_ENDPOINT: envUrl().optional(),
  STORAGE_REGION: z.string().max(64).default('us-east-1'),
  STORAGE_BUCKET: z
    .string()
    .regex(/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/, 'must be a valid bucket name')
    .optional(),
  STORAGE_ACCESS_KEY: optionalString,
  STORAGE_SECRET_KEY: optionalString,
  STORAGE_FORCE_PATH_STYLE: envBool(false),

  EVIDENCE_MAX_BYTES: envInt(DEFAULT_EVIDENCE_MAX_BYTES, 1024, 10 * 1024 * 1024 * 1024),
  EVIDENCE_MAX_BYTES_NON_STAFF: envInt(209_715_200, 1024, 10 * 1024 * 1024 * 1024),
  EVIDENCE_UPLOADS_PER_HOUR: envInt(60, 1, 1_000_000),
  EVIDENCE_UPLOADS_PER_HOUR_NON_STAFF: envInt(10, 1, 1_000_000),
  EVIDENCE_DAILY_BYTES_NON_STAFF: envInt(1_073_741_824, 1024, 1024 * 1024 * 1024 * 1024),

  SIGNATURE_MAX_SKEW_SECONDS: envInt(DEFAULT_SIGNATURE_MAX_SKEW_SECONDS, 5, 600),
  KEY_ROTATION_GRACE_SECONDS: envInt(DEFAULT_KEY_ROTATION_GRACE_SECONDS, 0, 86_400),
  REGISTRATION_TOKEN_TTL_HOURS: envInt(DEFAULTS.REGISTRATION_TOKEN_TTL_HOURS, 1, 720),

  VPN_PROVIDERS: envEnumList(VPN_PROVIDER_NAMES, ['noop']),
  VPN_CIDR_LIST_PATHS: z.string().transform(splitList).default([]),
  VPN_CIDR_CONFIDENCE: z.enum(VPN_CIDR_CONFIDENCES).default('likely'),
  PROXYCHECK_API_KEY: optionalString,
  IPHUB_API_KEY: optionalString,
  VPN_PROVIDER_TIMEOUT_MS: envInt(1_500, 100, 30_000),
  VPN_CACHE_TTL_SECONDS: envInt(21_600, 0, 604_800),

  STEAM_WEB_API_KEY: optionalString,
  ACCOUNT_AGE_CACHE_DAYS: envInt(7, 1, 365),
  ALT_LOOKBACK_DAYS: envInt(30, 1, 365),
  ALT_MAX_SHARED_ACCOUNTS: envInt(4, 1, 100),

  OVERWATCH_INTERVAL_SECONDS: envInt(
    OVERWATCH_DEFAULT_INTERVAL_SECONDS,
    OVERWATCH_MIN_INTERVAL_SECONDS,
    OVERWATCH_MAX_INTERVAL_SECONDS,
  ),
  OVERWATCH_HEARTBEAT_TIMEOUT_SECONDS: envInt(DEFAULTS.OVERWATCH_HEARTBEAT_TIMEOUT_SECONDS, 30, 3_600),
  PROOF_RATE_LIMIT_PER_MINUTE: envInt(DEFAULTS.PROOF_RATE_LIMIT_PER_MINUTE, 1, 1_000_000),
  WHITELIST_REQUEST_TTL_DAYS: envInt(DEFAULTS.WHITELIST_REQUEST_TTL_DAYS, 1, 365),

  RETENTION_NETWORK_OBSERVATIONS_DAYS: envInt(30, 1, 36_500),
  RETENTION_PLAYER_SIGNALS_DAYS: envInt(90, 1, 36_500),
  RETENTION_SESSIONS_DAYS: envInt(30, 1, 36_500),
  RETENTION_OVERWATCH_SECRETS_DAYS: envInt(365, 1, 36_500),

  JOBS_ENABLED: envBool(true),
  PUBLIC_CASE_LOOKUP: envBool(true),
  OPENAPI_UI: envOptionalBool(),
  LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
  LOG_CLIENT_IP: envBool(false),
  LOG_PRETTY: envBool(false),

  RATE_LIMIT_ENABLED: envBool(true),
  RATE_LIMIT_GLOBAL_PER_MINUTE: envInt(300, 1, 1_000_000),
  RATE_LIMIT_PLUGIN_PER_MINUTE: envInt(600, 1, 1_000_000),
  RATE_LIMIT_AUTH_PER_MINUTE: envInt(10, 1, 1_000_000),
  RATE_LIMIT_REPORTS_PER_HOUR: envInt(10, 1, 1_000_000),
  RATE_LIMIT_SERVER_AUTH_FAILURES_PER_MINUTE: envInt(30, 1, 1_000_000),
});
type ParsedEnv = z.infer<typeof EnvSchema>;

const DEV_DEFAULTS = {
  PUBLIC_BASE_URL: 'http://localhost:3000',
  WEB_ORIGIN: 'http://localhost:5173',
  DATABASE_URL: 'postgres://scpsl:scpsl@localhost:5432/scpsl_trust',
  MAIL_FROM: 'SCP:SL Trust Network <no-reply@localhost>',
} as const;

// ---------------------------------------------------------------------------
// Post-processing helpers
// ---------------------------------------------------------------------------

class Collector {
  readonly errors: string[] = [];
  readonly warnings: string[] = [];
}

function describeWeakness(problems: readonly SecretWeakness[]): string {
  const text: Record<SecretWeakness, string> = {
    too_short: 'shorter than 32 bytes of key material',
    low_entropy: 'too little entropy',
    placeholder: 'looks like a placeholder',
    repetitive: 'too repetitive',
  };
  return problems.map((problem) => text[problem]).join(', ');
}

function parseTrustProxy(raw: string | undefined, out: Collector): TrustProxySetting {
  if (raw === undefined) return false;
  const lowered = raw.toLowerCase();
  if (lowered === 'false' || lowered === '0' || lowered === 'no' || lowered === 'off') return false;
  if (lowered === 'true' || lowered === 'yes' || lowered === 'on') return true;
  if (/^\d+$/.test(raw)) {
    const hops = Number(raw);
    if (hops < 1 || hops > 10) out.errors.push('TRUST_PROXY: hop count must be between 1 and 10');
    return hops;
  }
  const entries = splitList(raw);
  for (const entry of entries) {
    const valid = entry.includes('/') ? isValidCidr(entry) : ipaddr.isValid(entry) || ['loopback', 'linklocal', 'uniquelocal'].includes(entry);
    if (!valid) out.errors.push(`TRUST_PROXY: "${entry}" is not an IP address, CIDR or known range name`);
  }
  return entries;
}

function isValidCidr(value: string): boolean {
  try {
    ipaddr.parseCIDR(value);
    return true;
  } catch {
    return false;
  }
}

function stripTrailingSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

function normalizeOrigin(value: string, name: string, out: Collector): string {
  const url = new URL(value);
  if ((url.pathname !== '/' && url.pathname !== '') || url.search !== '' || url.hash !== '') {
    out.errors.push(`${name}: must be an origin (scheme://host[:port]) without path, query or fragment`);
  }
  return url.origin;
}

interface SecretInput {
  name: string;
  value: string | undefined;
}

function resolveTextSecret(input: SecretInput, env: NodeEnv, out: Collector): string {
  if (input.value === undefined) {
    if (env === 'production') {
      out.errors.push(`${input.name} is required in production (generate with: openssl rand -base64 32)`);
      return '';
    }
    if (env === 'development') {
      out.warnings.push(`${input.name} is not set; using an EPHEMERAL random value (lost on restart). Never do this in production.`);
    }
    return randomBytes(32).toString('base64url');
  }
  const problems = assessSecret(input.value);
  if (problems.length > 0) {
    const message = `${input.name} is weak (${describeWeakness(problems)}); use at least 32 random bytes (openssl rand -base64 32)`;
    if (env === 'production') out.errors.push(message);
    else if (env === 'development') out.warnings.push(message);
  }
  return input.value;
}

/** DATA_ENCRYPTION_KEY: standard or url-safe base64 that decodes to exactly 32 bytes. */
function decodeEncryptionKey(value: string): Buffer | null {
  if (!/^[A-Za-z0-9+/_-]+={0,2}$/.test(value)) return null;
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const decoded = Buffer.from(normalized, 'base64');
  if (decoded.length !== 32) return null;
  if (decoded.toString('base64').replace(/=+$/, '') !== normalized.replace(/=+$/, '')) return null;
  return decoded;
}

function resolveEncryptionKey(value: string | undefined, env: NodeEnv, out: Collector): Buffer {
  if (value === undefined) {
    if (env === 'production') {
      out.errors.push('DATA_ENCRYPTION_KEY is required in production (generate with: openssl rand -base64 32)');
      return Buffer.alloc(32);
    }
    if (env === 'development') {
      out.warnings.push(
        'DATA_ENCRYPTION_KEY is not set; using an EPHEMERAL random key. Encrypted secrets (2FA, Overwatch) become unreadable after a restart.',
      );
    }
    return randomBytes(32);
  }
  const key = decodeEncryptionKey(value);
  if (key === null) {
    out.errors.push('DATA_ENCRYPTION_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32)');
    return Buffer.alloc(32);
  }
  const problems = assessKeyBytes(key);
  if (problems.length > 0) {
    const message = `DATA_ENCRYPTION_KEY is weak (${describeWeakness(problems)})`;
    if (env === 'production') out.errors.push(message);
    else if (env === 'development') out.warnings.push(message);
  }
  return key;
}

function formatZodIssues(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const name = issue.path.map(String).join('.') || '(env)';
    // Never echo received values: some variables are secrets.
    return `${name}: ${issue.message}`;
  });
}

// ---------------------------------------------------------------------------
// loadConfig
// ---------------------------------------------------------------------------

/**
 * Parses and validates the environment. Throws ConfigError listing every problem.
 * Relative directories are resolved against `cwd` (default process.cwd()).
 */
export function loadConfig(env: RawEnv = process.env, options: { cwd?: string } = {}): Config {
  const parsed = EnvSchema.safeParse(normalizeEnv(env));
  if (!parsed.success) throw new ConfigError(formatZodIssues(parsed.error));
  return buildConfig(parsed.data, options.cwd ?? process.cwd());
}

function buildConfig(raw: ParsedEnv, cwd: string): Config {
  const out = new Collector();
  const nodeEnv = raw.NODE_ENV;
  const isProduction = nodeEnv === 'production';

  const requiredInProduction = (name: keyof typeof DEV_DEFAULTS, value: string | undefined): string => {
    if (value !== undefined) return value;
    if (isProduction) out.errors.push(`${name} is required in production`);
    return DEV_DEFAULTS[name];
  };

  const publicBaseUrl = stripTrailingSlash(requiredInProduction('PUBLIC_BASE_URL', raw.PUBLIC_BASE_URL));
  const webOrigin = normalizeOrigin(requiredInProduction('WEB_ORIGIN', raw.WEB_ORIGIN), 'WEB_ORIGIN', out);
  const databaseUrl = requiredInProduction('DATABASE_URL', raw.DATABASE_URL);

  const redisUrl = raw.REDIS_URL ?? null;
  if (redisUrl === null) {
    if (isProduction) out.errors.push('REDIS_URL is required in production (nonces, rate limits, locks)');
    else if (nodeEnv === 'development') {
      out.warnings.push('REDIS_URL is not set; using in-memory stores (single process only, state lost on restart).');
    }
  }

  const secrets = {
    jwtSecret: resolveTextSecret({ name: 'JWT_SECRET', value: raw.JWT_SECRET }, nodeEnv, out),
    sessionSecret: resolveTextSecret({ name: 'SESSION_SECRET', value: raw.SESSION_SECRET }, nodeEnv, out),
    dataEncryptionKey: resolveEncryptionKey(raw.DATA_ENCRYPTION_KEY, nodeEnv, out),
    ipHashSecret: resolveTextSecret({ name: 'IP_HASH_SECRET', value: raw.IP_HASH_SECRET }, nodeEnv, out),
  };
  const textSecrets: Array<[string, string | undefined]> = [
    ['JWT_SECRET', raw.JWT_SECRET],
    ['SESSION_SECRET', raw.SESSION_SECRET],
    ['IP_HASH_SECRET', raw.IP_HASH_SECRET],
  ];
  for (let i = 0; i < textSecrets.length; i += 1) {
    for (let j = i + 1; j < textSecrets.length; j += 1) {
      const [nameA, a] = textSecrets[i] ?? ['', undefined];
      const [nameB, b] = textSecrets[j] ?? ['', undefined];
      if (a !== undefined && a === b) {
        const message = `${nameA} and ${nameB} must be different secrets`;
        if (isProduction) out.errors.push(message);
        else out.warnings.push(message);
      }
    }
  }

  if (isProduction && !raw.COOKIE_SECURE) {
    out.warnings.push('COOKIE_SECURE=false in production: session cookies are sent over plain HTTP.');
  }

  const transport: MailTransport = raw.MAIL_TRANSPORT ?? (isProduction ? 'smtp' : nodeEnv === 'test' ? 'noop' : 'file');
  const smtpUrl = raw.SMTP_URL ?? null;
  if (transport === 'smtp' && smtpUrl === null) out.errors.push('SMTP_URL is required when MAIL_TRANSPORT=smtp');
  if (isProduction && transport === 'file') out.errors.push('MAIL_TRANSPORT=file is for development only');
  if (isProduction && transport === 'noop') out.warnings.push('MAIL_TRANSPORT=noop in production: no e-mails are sent.');
  if (isProduction && transport === 'smtp' && raw.MAIL_FROM === undefined) {
    out.errors.push('MAIL_FROM is required in production');
  }

  const storage = {
    driver: raw.STORAGE_DRIVER,
    localDir: path.resolve(cwd, raw.STORAGE_LOCAL_DIR),
    endpoint: raw.STORAGE_ENDPOINT ?? null,
    region: raw.STORAGE_REGION,
    bucket: raw.STORAGE_BUCKET ?? null,
    accessKey: raw.STORAGE_ACCESS_KEY ?? null,
    secretKey: raw.STORAGE_SECRET_KEY ?? null,
    forcePathStyle: raw.STORAGE_FORCE_PATH_STYLE,
  };
  if (storage.driver === 's3') {
    if (storage.bucket === null) out.errors.push('STORAGE_BUCKET is required when STORAGE_DRIVER=s3');
    if ((storage.accessKey === null) !== (storage.secretKey === null)) {
      out.errors.push('STORAGE_ACCESS_KEY and STORAGE_SECRET_KEY must be set together');
    }
  }

  const providers = raw.VPN_PROVIDERS.length === 0 ? (['noop'] as VpnProviderName[]) : raw.VPN_PROVIDERS;
  if (providers.includes('cidr-list') && raw.VPN_CIDR_LIST_PATHS.length === 0) {
    out.errors.push('VPN_CIDR_LIST_PATHS is required when VPN_PROVIDERS contains cidr-list');
  }
  if (providers.includes('iphub') && raw.IPHUB_API_KEY === undefined) {
    out.errors.push('IPHUB_API_KEY is required when VPN_PROVIDERS contains iphub');
  }

  if (isProduction && raw.REQUIRE_2FA_ROLES.length === 0) {
    out.warnings.push('REQUIRE_2FA_ROLES is empty: staff accounts are not required to use 2FA.');
  }
  if (raw.SESSION_IDLE_TIMEOUT_MINUTES > raw.SESSION_TTL_HOURS * 60) {
    out.warnings.push('SESSION_IDLE_TIMEOUT_MINUTES exceeds SESSION_TTL_HOURS; the absolute lifetime applies first.');
  }

  const trustProxy = parseTrustProxy(raw.TRUST_PROXY, out);

  if (out.errors.length > 0) throw new ConfigError(out.errors);

  return deepFreeze({
    nodeEnv,
    isProduction,
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
    http: {
      host: raw.HOST,
      port: raw.PORT,
      publicBaseUrl,
      webOrigin,
      trustProxy,
      shutdownTimeoutMs: raw.SHUTDOWN_TIMEOUT_MS,
    },
    database: {
      url: databaseUrl,
      poolMax: raw.DATABASE_POOL_MAX,
      statementTimeoutMs: raw.DATABASE_STATEMENT_TIMEOUT_MS,
      autoMigrate: raw.AUTO_MIGRATE,
    },
    redis: { url: redisUrl, keyPrefix: raw.REDIS_KEY_PREFIX },
    secrets,
    cookies: { secure: raw.COOKIE_SECURE },
    session: { ttlHours: raw.SESSION_TTL_HOURS, idleTimeoutMinutes: raw.SESSION_IDLE_TIMEOUT_MINUTES },
    auth: {
      emailVerificationRequired: raw.EMAIL_VERIFICATION_REQUIRED,
      allowRegistration: raw.ALLOW_REGISTRATION,
      require2faRoles: raw.REQUIRE_2FA_ROLES,
      loginMaxFailures: raw.LOGIN_MAX_FAILURES,
    },
    mail: {
      transport,
      from: raw.MAIL_FROM ?? DEV_DEFAULTS.MAIL_FROM,
      smtpUrl,
      fileDir: path.resolve(cwd, raw.MAIL_FILE_DIR),
    },
    storage,
    evidence: {
      maxBytes: raw.EVIDENCE_MAX_BYTES,
      nonStaffMaxBytes: Math.min(raw.EVIDENCE_MAX_BYTES_NON_STAFF, raw.EVIDENCE_MAX_BYTES),
      uploadsPerHour: raw.EVIDENCE_UPLOADS_PER_HOUR,
      nonStaffUploadsPerHour: raw.EVIDENCE_UPLOADS_PER_HOUR_NON_STAFF,
      nonStaffDailyBytes: raw.EVIDENCE_DAILY_BYTES_NON_STAFF,
    },
    serverAuth: {
      signatureMaxSkewSeconds: raw.SIGNATURE_MAX_SKEW_SECONDS,
      keyRotationGraceSeconds: raw.KEY_ROTATION_GRACE_SECONDS,
      registrationTokenTtlHours: raw.REGISTRATION_TOKEN_TTL_HOURS,
    },
    vpn: {
      providers,
      cidrListPaths: raw.VPN_CIDR_LIST_PATHS.map((entry) => path.resolve(cwd, entry)),
      cidrConfidence: raw.VPN_CIDR_CONFIDENCE,
      proxycheckApiKey: raw.PROXYCHECK_API_KEY ?? null,
      iphubApiKey: raw.IPHUB_API_KEY ?? null,
      providerTimeoutMs: raw.VPN_PROVIDER_TIMEOUT_MS,
      cacheTtlSeconds: raw.VPN_CACHE_TTL_SECONDS,
    },
    accountAge: { steamWebApiKey: raw.STEAM_WEB_API_KEY ?? null, cacheDays: raw.ACCOUNT_AGE_CACHE_DAYS },
    alt: { lookbackDays: raw.ALT_LOOKBACK_DAYS, maxSharedAccounts: raw.ALT_MAX_SHARED_ACCOUNTS },
    overwatch: {
      intervalSeconds: raw.OVERWATCH_INTERVAL_SECONDS,
      heartbeatTimeoutSeconds: raw.OVERWATCH_HEARTBEAT_TIMEOUT_SECONDS,
    },
    proof: { rateLimitPerMinute: raw.PROOF_RATE_LIMIT_PER_MINUTE },
    whitelist: { requestTtlDays: raw.WHITELIST_REQUEST_TTL_DAYS },
    retention: {
      networkObservationsDays: raw.RETENTION_NETWORK_OBSERVATIONS_DAYS,
      playerSignalsDays: raw.RETENTION_PLAYER_SIGNALS_DAYS,
      sessionsDays: raw.RETENTION_SESSIONS_DAYS,
      overwatchSecretsDays: raw.RETENTION_OVERWATCH_SECRETS_DAYS,
    },
    jobs: { enabled: raw.JOBS_ENABLED },
    features: {
      publicCaseLookup: raw.PUBLIC_CASE_LOOKUP,
      openapiUi: raw.OPENAPI_UI ?? !isProduction,
    },
    logging: { level: raw.LOG_LEVEL, clientIp: raw.LOG_CLIENT_IP, pretty: raw.LOG_PRETTY },
    rateLimit: {
      enabled: raw.RATE_LIMIT_ENABLED,
      globalPerMinute: raw.RATE_LIMIT_GLOBAL_PER_MINUTE,
      pluginPerMinute: raw.RATE_LIMIT_PLUGIN_PER_MINUTE,
      authPerMinute: raw.RATE_LIMIT_AUTH_PER_MINUTE,
      reportsPerHour: raw.RATE_LIMIT_REPORTS_PER_HOUR,
      serverAuthFailuresPerMinute: raw.RATE_LIMIT_SERVER_AUTH_FAILURES_PER_MINUTE,
    },
    warnings: out.warnings,
  });
}

/** Freezes plain objects/arrays recursively (Buffers stay mutable-typed but are copied). */
function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Buffer.isBuffer(value)) {
    for (const member of Object.values(value as Record<string, unknown>)) deepFreeze(member);
    Object.freeze(value);
  }
  return value;
}
