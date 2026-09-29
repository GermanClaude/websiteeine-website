/**
 * Pagination helpers for list endpoints (`?page=&page_size=`, ARCHITECTURE §2.1).
 */
import { LIMITS, type Paginated } from '@scpsl-trust/shared';

export interface PageQuery {
  page: number;
  page_size: number;
}

export interface LimitOffset {
  limit: number;
  offset: number;
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value)));
}

/** Normalizes page/page_size (defensive; zod already validates requests). */
export function normalizePage(query: Partial<PageQuery>): PageQuery {
  return {
    page: clampInt(query.page ?? 1, 1, LIMITS.PAGE_MAX, 1),
    page_size: clampInt(query.page_size ?? LIMITS.PAGE_SIZE_DEFAULT, 1, LIMITS.PAGE_SIZE_MAX, LIMITS.PAGE_SIZE_DEFAULT),
  };
}

/** SQL LIMIT/OFFSET for a page. */
export function toOffset(query: Partial<PageQuery>): LimitOffset {
  const { page, page_size } = normalizePage(query);
  return { limit: page_size, offset: (page - 1) * page_size };
}

/** `{ items, page, page_size, total }`. */
export function paginatedResult<T>(items: T[], total: number, query: Partial<PageQuery>): Paginated<T> {
  const { page, page_size } = normalizePage(query);
  return { items, page, page_size, total: Math.max(0, Math.trunc(total)) };
}
