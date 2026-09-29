import { LIMITS } from '@scpsl-trust/shared';

import { Button } from './Button';

export const PAGE_SIZE_OPTIONS: readonly number[] = [10, 25, 50, 100];

export interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  /** Number of loaded rows (for the "x–y of z" label when the last page is short). */
  loaded?: number;
}

export function Pagination({ page, pageSize, total, onPageChange, onPageSizeChange, loaded }: PaginationProps) {
  const pageCount = Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const last = total === 0 ? 0 : Math.min(total, (page - 1) * pageSize + (loaded ?? pageSize));

  return (
    <nav className="pagination" aria-label="Pagination">
      <span className="pagination-info">
        {total === 0 ? 'No entries' : `${first}–${last} of ${total}`}
      </span>
      <div className="pagination-controls">
        {onPageSizeChange !== undefined && (
          <label className="pagination-size">
            <span className="text-muted">Per page</span>
            <select
              className="input"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Math.min(LIMITS.PAGE_SIZE_MAX, Number(event.target.value)))}
              aria-label="Rows per page"
            >
              {PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </select>
          </label>
        )}
        <Button size="sm" onClick={() => onPageChange(page - 1)} disabled={page <= 1} aria-label="Previous page">
          ‹ Prev
        </Button>
        <span className="text-muted nowrap" aria-current="page">
          Page {page} of {pageCount}
        </span>
        <Button size="sm" onClick={() => onPageChange(page + 1)} disabled={page >= pageCount} aria-label="Next page">
          Next ›
        </Button>
      </div>
    </nav>
  );
}
