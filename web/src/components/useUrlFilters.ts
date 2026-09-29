import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';

import { LIMITS } from '@scpsl-trust/shared';

export type UrlFilterValues<K extends string> = Readonly<Record<K, string>>;

export interface UrlFilters<K extends string> {
  /** Current values (defaults applied). */
  values: UrlFilterValues<K>;
  /** Sets one filter; resets `page` to 1 unless the key is `page` itself. */
  set: (key: K, value: string | number | null | undefined) => void;
  /** Sets several filters at once (page resets unless included). */
  setMany: (patch: Partial<Record<K, string | number | null | undefined>>) => void;
  reset: () => void;
  /** True when any non-pagination filter differs from its default. */
  isFiltered: boolean;
  page: number;
  pageSize: number;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  /** Values without empty strings, ready for `api.get(path, { query })`. */
  query: Partial<Record<K, string>> & { page: number; page_size: number };
}

const PAGE_KEYS = new Set(['page', 'page_size']);

/**
 * Keeps list filters in the query string (`?status=open&q=foo&page=2`) so pages are
 * shareable and the dashboard can deep-link into filtered lists.
 *
 *   const filters = useUrlFilters({ status: '', verdict: '', q: '' });
 *   useQuery({ queryKey: caseKeys.list(filters.query), queryFn: () => listCases(filters.query) })
 */
export function useUrlFilters<K extends string>(defaults: Readonly<Record<K, string>>): UrlFilters<K> {
  const [searchParams, setSearchParams] = useSearchParams();

  const values = useMemo(() => {
    const result = {} as Record<K, string>;
    for (const key of Object.keys(defaults) as K[]) {
      result[key] = searchParams.get(key) ?? defaults[key];
    }
    return result as UrlFilterValues<K>;
  }, [searchParams, defaults]);

  const page = Math.max(1, Number.parseInt(searchParams.get('page') ?? '1', 10) || 1);
  const pageSize = Math.min(
    LIMITS.PAGE_SIZE_MAX,
    Math.max(1, Number.parseInt(searchParams.get('page_size') ?? String(LIMITS.PAGE_SIZE_DEFAULT), 10) || LIMITS.PAGE_SIZE_DEFAULT),
  );

  const apply = useCallback(
    (patch: Record<string, string | number | null | undefined>, resetPage: boolean) => {
      setSearchParams(
        (current) => {
          const next = new URLSearchParams(current);
          for (const [key, value] of Object.entries(patch)) {
            const stringValue = value === null || value === undefined ? '' : String(value);
            const defaultValue = (defaults as Record<string, string | undefined>)[key] ?? '';
            if (stringValue === '' || stringValue === defaultValue) next.delete(key);
            else next.set(key, stringValue);
          }
          if (resetPage && !('page' in patch)) next.delete('page');
          return next;
        },
        { replace: true },
      );
    },
    [defaults, setSearchParams],
  );

  const set = useCallback((key: K, value: string | number | null | undefined) => apply({ [key]: value }, !PAGE_KEYS.has(key)), [apply]);
  const setMany = useCallback((patch: Partial<Record<K, string | number | null | undefined>>) => apply(patch, true), [apply]);
  const reset = useCallback(() => setSearchParams(new URLSearchParams(), { replace: true }), [setSearchParams]);
  const setPage = useCallback((next: number) => apply({ page: next <= 1 ? null : next }, false), [apply]);
  const setPageSize = useCallback(
    (next: number) => apply({ page_size: next === LIMITS.PAGE_SIZE_DEFAULT ? null : next, page: null }, false),
    [apply],
  );

  const isFiltered = (Object.keys(defaults) as K[]).some((key) => values[key] !== defaults[key]);

  const query = useMemo(() => {
    const result: Record<string, string | number> = { page, page_size: pageSize };
    for (const key of Object.keys(defaults) as K[]) {
      const value = values[key];
      if (value !== '') result[key] = value;
    }
    return result as Partial<Record<K, string>> & { page: number; page_size: number };
  }, [values, defaults, page, pageSize]);

  return { values, set, setMany, reset, isFiltered, page, pageSize, setPage, setPageSize, query };
}
