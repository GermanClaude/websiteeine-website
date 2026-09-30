/**
 * Shared helpers for the evidence/overwatch module tests: direct case/report rows
 * (independent of the cases module) and a multipart payload builder for app.inject().
 */
import { randomBytes } from 'node:crypto';

import type { Deps } from '../../../src/container';
import { MODULES } from '../../../src/modules';
import type { CaseRow, PlayerRow, ReportRow } from '../../../src/db/types';
import { createPlayer } from '../../helpers';

/** Only the modules under test (other agents' modules stay out of the app). */
export const EVIDENCE_MODULES = MODULES.filter((m) => m.name === 'evidence' || m.name === 'overwatch');

let caseCounter = 0;

export async function createCase(
  deps: Pick<Deps, 'db' | 'clock'>,
  options: { player?: PlayerRow } = {},
): Promise<{ caseRow: CaseRow; player: PlayerRow }> {
  const player = options.player ?? (await createPlayer(deps));
  const now = deps.clock.now();
  caseCounter += 1;
  const counter = (caseCounter * 1000 + (randomBytes(2).readUInt16BE(0) % 1000)) % 1000000;
  const caseRow = await deps.db
    .insertInto('cases')
    .values({
      case_number: `CASE-2026-${String(counter).padStart(6, '0')}`,
      player_id: player.id,
      reason: 'test case',
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
  return { caseRow, player };
}

export function addReport(
  deps: Pick<Deps, 'db' | 'clock'>,
  caseRow: CaseRow,
  reporter: { userId?: string; serverUuid?: string },
): Promise<ReportRow> {
  const now = deps.clock.now();
  return deps.db
    .insertInto('reports')
    .values({
      case_id: caseRow.id,
      player_id: caseRow.player_id,
      server_id: reporter.serverUuid ?? null,
      reporter_type: reporter.userId !== undefined ? 'user' : 'server',
      reporter_user_id: reporter.userId ?? null,
      reason: 'test report',
      created_at: now,
      updated_at: now,
    })
    .returningAll()
    .executeTakeFirstOrThrow();
}

export interface MultipartFile {
  filename: string;
  contentType: string;
  data: Buffer;
}

/** Builds a multipart/form-data payload with the fields first and the file last. */
export function multipartPayload(
  fields: Record<string, string>,
  file: MultipartFile | null,
): { payload: Buffer; headers: Record<string, string> } {
  const boundary = `----vitest${randomBytes(8).toString('hex')}`;
  const parts: Buffer[] = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\ncontent-disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'));
  }
  if (file !== null) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\ncontent-disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `content-type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
      file.data,
      Buffer.from('\r\n', 'utf8'),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return {
    payload: Buffer.concat(parts),
    headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
  };
}

/**
 * A tiny but structurally complete PNG (signature, IHDR, IDAT, IEND) that file-type
 * reliably detects as image/png; `extra` random padding is appended after IEND.
 */
export function pngBytes(extra = 0): Buffer {
  const chunk = (type: string, data: Buffer): Buffer => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    return Buffer.concat([length, Buffer.from(type, 'ascii'), data, Buffer.alloc(4)]);
  };
  const base = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.from('00000001000000010806000000', 'hex')),
    chunk('IDAT', Buffer.from([0x78, 0x9c, 0x62, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  return extra > 0 ? Buffer.concat([base, randomBytes(extra)]) : base;
}
