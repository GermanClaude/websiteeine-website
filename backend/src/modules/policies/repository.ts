/**
 * SQL for server policies (§4.3): versioned, immutable policy rows + rules.
 */
import type {
  DbExecutor,
  NewServerPolicy,
  NewServerPolicyRule,
  ServerPolicyRow,
  ServerPolicyRuleRow,
} from '../../db';

export interface PolicyWithRules {
  policy: ServerPolicyRow;
  rules: ServerPolicyRuleRow[];
}

export async function findActivePolicy(db: DbExecutor, serverUuid: string): Promise<ServerPolicyRow | undefined> {
  return db
    .selectFrom('server_policies')
    .selectAll()
    .where('server_id', '=', serverUuid)
    .where('is_active', '=', true)
    .executeTakeFirst();
}

/** Active policy row locked FOR UPDATE (serializes concurrent saves per server). */
export async function findActivePolicyForUpdate(
  db: DbExecutor,
  serverUuid: string,
): Promise<ServerPolicyRow | undefined> {
  return db
    .selectFrom('server_policies')
    .selectAll()
    .where('server_id', '=', serverUuid)
    .where('is_active', '=', true)
    .forUpdate()
    .executeTakeFirst();
}

export async function findPolicyRules(db: DbExecutor, policyId: string): Promise<ServerPolicyRuleRow[]> {
  return db
    .selectFrom('server_policy_rules')
    .selectAll()
    .where('policy_id', '=', policyId)
    .orderBy('sort_order', 'asc')
    .execute();
}

export async function insertPolicy(db: DbExecutor, policy: NewServerPolicy): Promise<ServerPolicyRow> {
  return db.insertInto('server_policies').values(policy).returningAll().executeTakeFirstOrThrow();
}

export async function insertPolicyRules(db: DbExecutor, rules: NewServerPolicyRule[]): Promise<ServerPolicyRuleRow[]> {
  if (rules.length === 0) return [];
  const inserted = await db.insertInto('server_policy_rules').values(rules).returningAll().execute();
  return [...inserted].sort((a, b) => a.sort_order - b.sort_order);
}

export async function deactivatePolicy(db: DbExecutor, policyId: string): Promise<void> {
  await db.updateTable('server_policies').set({ is_active: false }).where('id', '=', policyId).execute();
}

export async function listPolicyVersions(
  db: DbExecutor,
  serverUuid: string,
  { limit, offset }: { limit: number; offset: number },
): Promise<{ policies: ServerPolicyRow[]; total: number }> {
  const [policies, count] = await Promise.all([
    db
      .selectFrom('server_policies')
      .selectAll()
      .where('server_id', '=', serverUuid)
      .orderBy('version', 'desc')
      .limit(limit)
      .offset(offset)
      .execute(),
    db
      .selectFrom('server_policies')
      .select((eb) => eb.fn.countAll<number>().as('total'))
      .where('server_id', '=', serverUuid)
      .executeTakeFirstOrThrow(),
  ]);
  return { policies, total: Number(count.total) };
}

export async function findRulesForPolicies(
  db: DbExecutor,
  policyIds: string[],
): Promise<Map<string, ServerPolicyRuleRow[]>> {
  const map = new Map<string, ServerPolicyRuleRow[]>();
  if (policyIds.length === 0) return map;
  const rows = await db
    .selectFrom('server_policy_rules')
    .selectAll()
    .where('policy_id', 'in', policyIds)
    .orderBy('sort_order', 'asc')
    .execute();
  for (const row of rows) {
    const list = map.get(row.policy_id) ?? [];
    list.push(row);
    map.set(row.policy_id, list);
  }
  return map;
}

/** Usernames for `created_by` attribution in policy views. */
export async function findUserRefs(db: DbExecutor, userIds: string[]): Promise<Map<string, { id: string; username: string }>> {
  const map = new Map<string, { id: string; username: string }>();
  const distinct = [...new Set(userIds)];
  if (distinct.length === 0) return map;
  const rows = await db.selectFrom('users').select(['id', 'username']).where('id', 'in', distinct).execute();
  for (const row of rows) map.set(row.id, row);
  return map;
}
