/**
 * shared/src is consumed by the browser web app: it must not depend on Node built-ins.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '../src');

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    return statSync(full).isDirectory() ? sourceFiles(full) : full.endsWith('.ts') ? [full] : [];
  });
}

const FORBIDDEN: Array<[string, RegExp]> = [
  ['node: import', /from\s+['"]node:/],
  ['bare Node built-in import', /from\s+['"](?:crypto|fs|path|os|util|buffer|stream|url|child_process|http|https|net)['"]/],
  ['require()', /\brequire\s*\(/],
  ['Buffer global', /\bBuffer\b/],
  ['process global', /\bprocess\./],
  ['__dirname', /\b__dirname\b/],
];

describe('runtime-agnostic source', () => {
  const files = sourceFiles(SRC);

  it('finds the source files', () => {
    expect(files.length).toBeGreaterThan(20);
  });

  it.each(files.map((file) => [relative(SRC, file), file] as const))('%s uses no Node-only APIs', (_name, file) => {
    const code = readFileSync(file, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    for (const [label, pattern] of FORBIDDEN) {
      expect(pattern.test(code), `${label} in ${file}`).toBe(false);
    }
  });

  it('only imports zod and relative modules', () => {
    for (const file of files) {
      const imports = [...readFileSync(file, 'utf8').matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');
      for (const specifier of imports) {
        expect(specifier === 'zod' || specifier.startsWith('./') || specifier.startsWith('../'), `${specifier} in ${file}`).toBe(true);
      }
    }
  });
});
