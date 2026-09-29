/**
 * Generates the cross-language fixtures in shared/test-vectors/.
 *
 *   pnpm exec tsx scripts/generate-test-vectors.ts          # (re)write the JSON files
 *   pnpm exec tsx scripts/generate-test-vectors.ts --check  # fail if committed files are stale
 *
 * Every builder cross-checks its output (independent re-implementations, self-verification,
 * hand-written policy expectations) and throws instead of writing inconsistent vectors.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildAuditVectors } from './vectors/audit';
import { buildPolicyVectors } from './vectors/policy';
import { buildProofVectors } from './vectors/proof';
import { buildSigningVectors } from './vectors/signing';

const outDir = resolve(dirname(fileURLToPath(import.meta.url)), '../test-vectors');

const files: Record<string, unknown> = {
  'signing.json': buildSigningVectors(),
  'proof-codes.json': buildProofVectors(),
  'policy.json': buildPolicyVectors(),
  'audit-chain.json': buildAuditVectors(),
};

const check = process.argv.includes('--check');
let stale = 0;
for (const [name, data] of Object.entries(files)) {
  const target = join(outDir, name);
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (check) {
    const current = existsSync(target) ? readFileSync(target, 'utf8') : null;
    if (current !== text) {
      stale += 1;
      console.error(`stale: ${name}`);
    }
  } else {
    writeFileSync(target, text, 'utf8');
    console.log(`wrote ${name}`);
  }
}

if (stale > 0) {
  console.error(`${stale} test-vector file(s) are out of date; run without --check to regenerate.`);
  process.exitCode = 1;
}
