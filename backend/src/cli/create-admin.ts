/**
 * Bootstrap CLI: creates a verified super_admin (ARCHITECTURE §12.2).
 *
 *   pnpm --filter @scpsl-trust/backend cli:create-admin --email admin@example.org --username admin
 *
 * The password comes from ADMIN_PASSWORD or an interactive hidden prompt (asked twice).
 * Weak passwords are refused. Needs DATABASE_URL.
 */
import { parseArgs } from 'node:util';

import { createSilentLogger } from '../lib/logger';
import { systemClock } from '../lib/time';
import { bootstrapSuperAdmin, BootstrapError } from './support/bootstrap-admin';
import { describeCliError, openCliDatabase } from './support/database';
import { promptHidden } from './support/prompt';

const USAGE = `Usage: create-admin --email <email> --username <username>
  Password: ADMIN_PASSWORD environment variable, or an interactive hidden prompt.
  Requires DATABASE_URL (defaults to the local development database outside production).`;

async function readPassword(): Promise<string> {
  const fromEnv = process.env['ADMIN_PASSWORD'];
  if (fromEnv !== undefined && fromEnv !== '') return fromEnv;
  const first = await promptHidden('Password: ');
  const second = await promptHidden('Repeat password: ');
  if (first !== second) throw new BootstrapError(['Passwords do not match']);
  return first;
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      email: { type: 'string' },
      username: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (values.email === undefined || values.username === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 1;
  }
  const password = await readPassword();
  const handle = openCliDatabase();
  try {
    const user = await bootstrapSuperAdmin(
      { db: handle.db, clock: systemClock, logger: createSilentLogger() },
      { email: values.email, username: values.username, password },
    );
    process.stdout.write(`Created super_admin ${user.username} (${user.id}).\n`);
    return 0;
  } finally {
    await handle.destroy();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    if (err instanceof BootstrapError) {
      for (const problem of err.problems) process.stderr.write(`error: ${problem}\n`);
    } else {
      process.stderr.write(`error: ${describeCliError(err)}\n`);
    }
    process.exitCode = 1;
  },
);
