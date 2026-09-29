/**
 * Database access for CLIs: only DATABASE_URL is needed (no web secrets).
 */
import { createDatabase, type DatabaseHandle } from '../../db/kysely';

const DEV_DATABASE_URL = 'postgres://scpsl:scpsl@localhost:5432/scpsl_trust';

export function cliDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const url = env['DATABASE_URL']?.trim();
  if (url !== undefined && url !== '') return url;
  if (env['NODE_ENV'] === 'production') throw new Error('DATABASE_URL is required');
  return DEV_DATABASE_URL;
}

export function openCliDatabase(env: NodeJS.ProcessEnv = process.env): DatabaseHandle {
  return createDatabase({ connectionString: cliDatabaseUrl(env), poolMax: 2, applicationName: 'scpsl-trust-cli' });
}

/** Error text without connection strings or credentials. */
export function describeCliError(err: unknown): string {
  const message = err instanceof Error ? err.message : String(err);
  return message.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, 'postgres://[redacted]');
}
