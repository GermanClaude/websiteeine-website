/**
 * Creates the first super_admin (ARCHITECTURE §12.2 bootstrap): verified e-mail, argon2id
 * password, reviewer pseudonym number, audited as USER_REGISTERED by the system actor.
 */
import type { Kysely } from 'kysely';

import { EmailInputSchema, USERNAME_REGEX } from '@scpsl-trust/shared';

import { isUniqueViolation } from '../../db/errors';
import { nextReviewerNumber } from '../../db/sequences';
import { withTransaction } from '../../db/tx';
import type { Database, UserRow } from '../../db/types';
import { checkPasswordPolicy, describePasswordProblems, hashPassword } from '../../lib/passwords';
import type { Clock } from '../../lib/time';
import { AuditService, SYSTEM_ACTOR } from '../../modules/audit/service';
import type { AppLogger } from '../../lib/logger';

export interface BootstrapAdminInput {
  email: string;
  username: string;
  password: string;
}

export class BootstrapError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(problems.join('; '));
    this.name = 'BootstrapError';
  }
}

export function validateBootstrapInput(input: BootstrapAdminInput): { email: string; username: string } {
  const problems: string[] = [];
  const email = EmailInputSchema.safeParse(input.email);
  if (!email.success) problems.push('Invalid e-mail address');
  if (!USERNAME_REGEX.test(input.username)) problems.push('Username must be 3-32 characters [A-Za-z0-9_.-]');
  problems.push(
    ...describePasswordProblems(checkPasswordPolicy(input.password, { email: input.email, username: input.username })),
  );
  if (problems.length > 0 || !email.success) throw new BootstrapError(problems);
  return { email: email.data, username: input.username };
}

export async function bootstrapSuperAdmin(
  deps: { db: Kysely<Database>; clock: Clock; logger: AppLogger },
  input: BootstrapAdminInput,
): Promise<UserRow> {
  const { email, username } = validateBootstrapInput(input);
  const passwordHash = await hashPassword(input.password);
  const audit = new AuditService(deps);
  try {
    return await withTransaction(deps.db, async (trx) => {
      const now = deps.clock.now();
      const user = await trx
        .insertInto('users')
        .values({
          email,
          username,
          password_hash: passwordHash,
          role: 'super_admin',
          status: 'active',
          email_verified_at: now,
          reviewer_number: await nextReviewerNumber(trx),
          created_at: now,
          updated_at: now,
        })
        .returningAll()
        .executeTakeFirstOrThrow();
      await audit.record(trx, {
        actor: SYSTEM_ACTOR,
        action: 'USER_REGISTERED',
        target_type: 'user',
        target_id: user.id,
        metadata: { source: 'cli', role: 'super_admin', username },
      });
      return user;
    });
  } catch (err) {
    if (isUniqueViolation(err, 'users_email_key') || isUniqueViolation(err, 'users_username_key')) {
      throw new BootstrapError(['A user with this e-mail or username already exists']);
    }
    throw err;
  }
}
