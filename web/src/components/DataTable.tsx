import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';

import { EmptyState } from './EmptyState';
import { LoadingState } from './Spinner';

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  /** Enables client-side sorting on this column. */
  sortValue?: (row: T) => string | number | null | undefined;
  align?: 'left' | 'right';
  /** Allows wrapping long text. */
  wrap?: boolean;
  width?: string;
  className?: string;
}

export interface DataTableProps<T> {
  columns: readonly Column<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  onRowClick?: (row: T) => void;
  /** Accessible description of what a row click does. */
  rowClickLabel?: string;
  loading?: boolean;
  error?: ReactNode;
  emptyState?: ReactNode;
  caption?: string;
  dense?: boolean;
  /** Initial sort (only for columns with `sortValue`). */
  defaultSort?: { key: string; direction: 'asc' | 'desc' };
  rowClassName?: (row: T) => string | undefined;
}

type SortState = { key: string; direction: 'asc' | 'desc' } | null;

function compare(a: string | number | null | undefined, b: string | number | null | undefined): number {
  if (a === b) return 0;
  if (a === null || a === undefined) return 1;
  if (b === null || b === undefined) return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * Dense data table inside a horizontally scrolling container. Server-side pagination and
 * filtering are the norm; `sortValue` enables optional client-side sorting of the loaded page.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  rowClickLabel,
  loading = false,
  error,
  emptyState,
  caption,
  dense = true,
  defaultSort,
  rowClassName,
}: DataTableProps<T>) {
  const [sort, setSort] = useState<SortState>(defaultSort ?? null);

  const sortedRows = useMemo(() => {
    if (sort === null) return rows;
    const column = columns.find((candidate) => candidate.key === sort.key);
    if (column?.sortValue === undefined) return rows;
    const accessor = column.sortValue;
    const copy = [...rows];
    copy.sort((a, b) => (sort.direction === 'asc' ? 1 : -1) * compare(accessor(a), accessor(b)));
    return copy;
  }, [rows, sort, columns]);

  const toggleSort = (key: string) => {
    setSort((current) => {
      if (current === null || current.key !== key) return { key, direction: 'asc' };
      if (current.direction === 'asc') return { key, direction: 'desc' };
      return null;
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTableRowElement>, row: T) => {
    if (onRowClick === undefined) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onRowClick(row);
    }
  };

  const clickable = onRowClick !== undefined;
  const tableClass = dense ? 'table table-dense' : 'table';

  return (
    <div className="table-wrap">
      <table className={tableClass}>
        {caption !== undefined && <caption>{caption}</caption>}
        <thead>
          <tr>
            {columns.map((column) => {
              const sortable = column.sortValue !== undefined;
              const active = sort !== null && sort.key === column.key;
              const ariaSort = active ? (sort.direction === 'asc' ? 'ascending' : 'descending') : undefined;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={[column.align === 'right' ? 'th-right' : '', column.className ?? ''].filter(Boolean).join(' ') || undefined}
                  style={column.width !== undefined ? { width: column.width } : undefined}
                  aria-sort={ariaSort}
                >
                  {sortable ? (
                    <button type="button" className="table-sort-button" onClick={() => toggleSort(column.key)}>
                      {column.header}
                      <span aria-hidden="true">{active ? (sort.direction === 'asc' ? '▲' : '▼') : '↕'}</span>
                    </button>
                  ) : (
                    column.header
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length}>
                <LoadingState />
              </td>
            </tr>
          ) : error !== undefined && error !== null ? (
            <tr>
              <td colSpan={columns.length}>{error}</td>
            </tr>
          ) : sortedRows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="table-empty">
                {emptyState ?? <EmptyState title="No results" />}
              </td>
            </tr>
          ) : (
            sortedRows.map((row) => {
              const extra = rowClassName?.(row);
              const className = [clickable ? 'table-row-clickable' : '', extra ?? ''].filter(Boolean).join(' ') || undefined;
              return (
                <tr
                  key={rowKey(row)}
                  className={className}
                  onClick={clickable ? () => onRowClick(row) : undefined}
                  onKeyDown={clickable ? (event) => onKeyDown(event, row) : undefined}
                  tabIndex={clickable ? 0 : undefined}
                  role={clickable ? 'link' : undefined}
                  aria-label={clickable && rowClickLabel !== undefined ? rowClickLabel : undefined}
                >
                  {columns.map((column) => (
                    <td
                      key={column.key}
                      className={
                        [column.align === 'right' ? 'td-right' : '', column.wrap ? 'td-wrap' : '', column.className ?? '']
                          .filter(Boolean)
                          .join(' ') || undefined
                      }
                    >
                      {column.render(row)}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}
