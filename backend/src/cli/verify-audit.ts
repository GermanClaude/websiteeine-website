/**
 * Recomputes the audit hash chain (ARCHITECTURE §9.1) and reports the first broken seq.
 *
 *   pnpm --filter @scpsl-trust/backend cli:verify-audit [--from-seq N] [--limit N] [--record] [--json]
 *
 * Exit codes: 0 valid, 2 chain broken, 1 error. --record appends AUDIT_CHAIN_VERIFIED
 * (system actor); by default the command is read-only.
 */
import { parseArgs } from 'node:util';

import { createSilentLogger } from '../lib/logger';
import { systemClock } from '../lib/time';
import { AuditService, SYSTEM_ACTOR } from '../modules/audit/service';
import { describeCliError, openCliDatabase } from './support/database';

const USAGE = 'Usage: verify-audit [--from-seq N] [--limit N] [--record] [--json]';

function positiveInt(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  if (!/^[1-9]\d{0,15}$/.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

async function main(): Promise<number> {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter((arg) => arg !== '--'),
    options: {
      'from-seq': { type: 'string' },
      limit: { type: 'string' },
      record: { type: 'boolean' },
      json: { type: 'boolean' },
      help: { type: 'boolean', short: 'h' },
    },
    strict: true,
  });
  if (values.help === true) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const options: { fromSeq?: number; limit?: number } = {};
  const fromSeq = positiveInt(values['from-seq'], '--from-seq');
  const limit = positiveInt(values.limit, '--limit');
  if (fromSeq !== undefined) options.fromSeq = fromSeq;
  if (limit !== undefined) options.limit = limit;

  const handle = openCliDatabase();
  try {
    const audit = new AuditService({ db: handle.db, clock: systemClock, logger: createSilentLogger() });
    const result = await audit.verifyChain(options);
    if (values.record === true) {
      await audit.record(handle.db, {
        actor: SYSTEM_ACTOR,
        action: 'AUDIT_CHAIN_VERIFIED',
        target_type: 'audit_log',
        metadata: {
          source: 'cli',
          valid: result.valid,
          checked_events: result.checked,
          first_broken_seq: result.first_invalid_seq,
          failure: result.reason,
        },
      });
    }
    if (values.json === true) {
      process.stdout.write(`${JSON.stringify(result)}\n`);
    } else if (result.valid) {
      process.stdout.write(`Audit chain valid: ${result.checked} event(s) checked, last seq ${result.last_seq ?? '-'}.\n`);
    } else {
      process.stdout.write(
        `Audit chain BROKEN at seq ${result.first_invalid_seq ?? '?'} (${result.reason ?? 'unknown'}); ${result.checked} event(s) checked.\n`,
      );
    }
    return result.valid ? 0 : 2;
  } finally {
    await handle.destroy();
  }
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stderr.write(`error: ${describeCliError(err)}\n`);
    process.exitCode = 1;
  },
);
