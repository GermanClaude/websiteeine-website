/**
 * CLI: apply pending database migrations.
 *
 *   pnpm migrate            apply pending migrations to DATABASE_URL
 *   pnpm migrate --status   list applied / pending migrations
 *
 * Environment: DATABASE_URL (required), MIGRATIONS_DIR (optional override).
 * Exit code 0 on success, 1 on any failure. Credentials are never printed.
 */
import { getMigrationStatus, MigrationError, runMigrations } from '../db/migrator';
import type { MigrationLogger } from '../db/migrator';
import { resolveMigrationsDir } from '../db/paths';

const USAGE = `Usage: migrate [--status]

Applies pending SQL migrations (backend/migrations) to DATABASE_URL.

Options:
  --status   show applied / pending migrations without changing anything
  --help     show this help

Environment:
  DATABASE_URL     PostgreSQL connection string (required)
  MIGRATIONS_DIR   migrations directory (default: <backend>/migrations)`;

const logger: MigrationLogger = {
  info: (message) => process.stdout.write(`[migrate] ${message}\n`),
  warn: (message) => process.stderr.write(`[migrate] WARNING: ${message}\n`),
};

/** host:port/database of a connection string, without credentials. */
function describeTarget(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    const database = decodeURIComponent(url.pathname.replace(/^\//, '')) || '(default)';
    return `${url.hostname || 'localhost'}${url.port ? `:${url.port}` : ''}/${database}`;
  } catch {
    return '(unparseable DATABASE_URL)';
  }
}

/** Removes the connection string and its password from a message, just in case. */
function redact(message: string, connectionString: string): string {
  let result = message.split(connectionString).join('<DATABASE_URL>');
  try {
    const password = decodeURIComponent(new URL(connectionString).password);
    if (password.length > 0) result = result.split(password).join('***');
  } catch {
    // not a URL: nothing more to redact
  }
  return result;
}

async function main(rawArgs: readonly string[]): Promise<number> {
  // `pnpm migrate -- --status` forwards the literal "--" separator.
  const argv = rawArgs.filter((arg) => arg !== '--');
  const unknown = argv.filter((arg) => arg !== '--status' && arg !== '--help' && arg !== '-h');
  if (argv.includes('--help') || argv.includes('-h')) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (unknown.length > 0) {
    process.stderr.write(`[migrate] Unknown argument(s): ${unknown.join(' ')}\n\n${USAGE}\n`);
    return 1;
  }

  const connectionString = process.env['DATABASE_URL']?.trim() ?? '';
  if (connectionString === '') {
    process.stderr.write('[migrate] DATABASE_URL is not set\n');
    return 1;
  }

  try {
    const migrationsDir = resolveMigrationsDir();
    logger.info(`Target ${describeTarget(connectionString)}, migrations from ${migrationsDir}`);

    if (argv.includes('--status')) {
      const entries = await getMigrationStatus({ connectionString, migrationsDir });
      for (const entry of entries) {
        const appliedAt = entry.appliedAt ? ` (applied ${entry.appliedAt.toISOString()})` : '';
        process.stdout.write(`${entry.state.padEnd(17)} ${entry.version}${appliedAt}\n`);
      }
      const problems = entries.filter((entry) => entry.state === 'checksum_mismatch' || entry.state === 'missing_file');
      return problems.length > 0 ? 1 : 0;
    }

    const result = await runMigrations({ connectionString, migrationsDir, logger });
    logger.info(
      `Done: ${result.applied.length} applied, ${result.alreadyApplied.length} already applied` +
        (result.applied.length > 0 ? ` (${result.applied.join(', ')})` : ''),
    );
    return 0;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const code = err instanceof MigrationError ? ` [${err.code}]` : '';
    process.stderr.write(`[migrate] FAILED${code}: ${redact(message, connectionString)}\n`);
    return 1;
  }
}

process.exitCode = await main(process.argv.slice(2));
