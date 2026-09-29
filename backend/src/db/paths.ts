/**
 * Locates backend/migrations at runtime, both when running from source (tsx,
 * vitest: src/db/*.ts) and from the tsup bundle (dist/*.js).
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BACKEND_PACKAGE_NAME = '@scpsl-trust/backend';

function isBackendPackageDir(dir: string): boolean {
  const manifest = path.join(dir, 'package.json');
  if (!existsSync(manifest)) return false;
  try {
    const parsed: unknown = JSON.parse(readFileSync(manifest, 'utf8'));
    return typeof parsed === 'object' && parsed !== null && Reflect.get(parsed, 'name') === BACKEND_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function isDirectory(dir: string): boolean {
  try {
    return statSync(dir).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Walks up from `startDir` (default: this module's directory) to the backend
 * package root (package.json named @scpsl-trust/backend). Falls back to the
 * nearest ancestor containing a `migrations` directory (e.g. a slim container
 * image without package.json).
 */
export function findBackendRoot(startDir: string = path.dirname(fileURLToPath(import.meta.url))): string {
  let fallback: string | undefined;
  let dir = path.resolve(startDir);
  for (;;) {
    if (isBackendPackageDir(dir)) return dir;
    if (fallback === undefined && isDirectory(path.join(dir, 'migrations'))) fallback = dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  if (fallback !== undefined) return fallback;
  throw new Error(`Cannot locate the ${BACKEND_PACKAGE_NAME} package root from ${startDir}; set MIGRATIONS_DIR`);
}

/** MIGRATIONS_DIR (absolute or relative to cwd) or <backend root>/migrations. */
export function resolveMigrationsDir(env: NodeJS.ProcessEnv = process.env): string {
  const override = env['MIGRATIONS_DIR']?.trim();
  if (override !== undefined && override !== '') return path.resolve(override);
  return path.join(findBackendRoot(), 'migrations');
}
