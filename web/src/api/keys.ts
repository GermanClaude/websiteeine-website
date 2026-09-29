/**
 * TanStack Query key conventions.
 *
 * Every area creates its keys with `createQueryKeys('<area>')` inside its own `src/api/<area>.ts`
 * (e.g. `export const caseKeys = createQueryKeys('cases')`) so this file never needs editing:
 *
 *   caseKeys.all                      → ['cases']                       invalidate everything
 *   caseKeys.lists()                  → ['cases', 'list']               invalidate all lists
 *   caseKeys.list({ status: 'open' }) → ['cases', 'list', { status }]   one filtered page
 *   caseKeys.details()                → ['cases', 'detail']
 *   caseKeys.detail('CASE-2026-…')    → ['cases', 'detail', id]
 *   caseKeys.sub(id, 'evidence', q)   → ['cases', 'detail', id, 'evidence', q]  nested collection
 *
 * After a mutation: `queryClient.invalidateQueries({ queryKey: caseKeys.all })` (or a narrower key).
 */
export type QueryFilters = Readonly<Record<string, unknown>>;

export function createQueryKeys<const Scope extends string>(scope: Scope) {
  return {
    all: [scope] as const,
    lists: () => [scope, 'list'] as const,
    list: (filters: QueryFilters = {}) => [scope, 'list', filters] as const,
    details: () => [scope, 'detail'] as const,
    detail: (id: string) => [scope, 'detail', id] as const,
    sub: (id: string, name: string, filters: QueryFilters = {}) => [scope, 'detail', id, name, filters] as const,
  };
}

export type QueryKeys<Scope extends string> = ReturnType<typeof createQueryKeys<Scope>>;

/** Foundation keys. */
export const authKeys = {
  all: ['auth'] as const,
  session: ['auth', 'session'] as const,
  sessions: ['auth', 'sessions'] as const,
};

export const meKeys = {
  all: ['me'] as const,
  profile: ['me', 'profile'] as const,
};

export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: ['dashboard', 'summary'] as const,
};
