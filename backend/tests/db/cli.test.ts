import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { findBackendRoot } from '../../src/db/paths';
import { createTestDatabase } from '../helpers/test-db';
import type { TestDatabase } from '../helpers/test-db';

const execFileAsync = promisify(execFile);
const backendRoot = findBackendRoot();
const tsx = path.join(backendRoot, 'node_modules', '.bin', 'tsx');
const cli = path.join(backendRoot, 'src', 'cli', 'migrate.ts');

interface CliResult {
  code: number;
  stdout: string;
  stderr: string;
}

async function runCli(args: string[], env: Record<string, string | undefined>): Promise<CliResult> {
  const childEnv: NodeJS.ProcessEnv = { PATH: process.env['PATH'], HOME: process.env['HOME'] };
  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) childEnv[key] = value;
  }
  try {
    const { stdout, stderr } = await execFileAsync(tsx, [cli, ...args], { env: childEnv, cwd: backendRoot, timeout: 60_000 });
    return { code: 0, stdout, stderr };
  } catch (err) {
    const failure = err as { code?: unknown; stdout?: string; stderr?: string };
    return {
      code: typeof failure.code === 'number' ? failure.code : -1,
      stdout: failure.stdout ?? '',
      stderr: failure.stderr ?? '',
    };
  }
}

describe('migrate CLI', () => {
  let target: TestDatabase;

  beforeAll(async () => {
    target = await createTestDatabase({ migrate: false });
  });

  afterAll(async () => {
    await target.destroy();
  });

  it('applies migrations, then reports an up-to-date schema', async () => {
    const first = await runCli([], { DATABASE_URL: target.url });
    expect(first.code).toBe(0);
    expect(first.stdout).toContain('Applied migration 0001_extensions_and_functions');
    expect(first.stdout).toMatch(/Done: \d+ applied, 0 already applied/);

    const second = await runCli([], { DATABASE_URL: target.url });
    expect(second.code).toBe(0);
    expect(second.stdout).toContain('Database schema is up to date');
    expect(second.stdout).toMatch(/Done: 0 applied, \d+ already applied/);

    // `pnpm migrate -- --status` forwards the "--" separator
    const status = await runCli(['--', '--status'], { DATABASE_URL: target.url });
    expect(status.code).toBe(0);
    expect(status.stdout).toMatch(/^applied\s+0001_extensions_and_functions/m);
    expect(status.stdout).not.toMatch(/^pending/m);
  });

  it('never prints credentials and exits 1 when the database is unreachable', async () => {
    const secret = 'Sup3r-Secret-Passw0rd';
    const url = `postgres://scpsl:${secret}@127.0.0.1:1/scpsl_trust`;
    const result = await runCli([], { DATABASE_URL: url });
    expect(result.code).toBe(1);
    expect(result.stderr).toContain('FAILED');
    expect(`${result.stdout}${result.stderr}`).not.toContain(secret);
    expect(`${result.stdout}${result.stderr}`).not.toContain(url);
    expect(result.stdout).toContain('127.0.0.1:1/scpsl_trust');
  });

  it('exits 1 on wrong credentials without echoing them', async () => {
    const url = new URL(target.url);
    url.password = 'definitely-wrong-password';
    const result = await runCli([], { DATABASE_URL: url.toString() });
    expect(result.code).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain('definitely-wrong-password');
  });

  it('exits 1 without DATABASE_URL, on unknown arguments and on a bad MIGRATIONS_DIR', async () => {
    expect((await runCli([], {})).code).toBe(1);
    const unknown = await runCli(['--drop-everything'], { DATABASE_URL: target.url });
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('Unknown argument');
    const badDir = await runCli([], { DATABASE_URL: target.url, MIGRATIONS_DIR: '/nonexistent/migrations' });
    expect(badDir.code).toBe(1);
    expect(badDir.stderr).toContain('MIGRATION_DIR_NOT_FOUND');
    const help = await runCli(['--help'], {});
    expect(help.code).toBe(0);
    expect(help.stdout).toContain('Usage: migrate');
  });
});
