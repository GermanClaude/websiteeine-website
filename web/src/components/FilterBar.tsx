import { useEffect, useState, type FormEvent, type ReactNode } from 'react';

import { Button } from './Button';

export interface FilterBarProps {
  children: ReactNode;
  /** Shown when `isFiltered` is true. */
  onReset?: () => void;
  isFiltered?: boolean;
  /** Extra content on the right (e.g. a "Create" button). */
  actions?: ReactNode;
}

/** Horizontal filter row placed above a table (inside a flush card). */
export function FilterBar({ children, onReset, isFiltered = false, actions }: FilterBarProps) {
  return (
    <div className="filter-bar" role="search">
      {children}
      {(onReset !== undefined || actions !== undefined) && (
        <div className="filter-actions" style={{ marginLeft: 'auto' }}>
          {onReset !== undefined && isFiltered && (
            <Button size="sm" variant="ghost" onClick={onReset}>
              Reset filters
            </Button>
          )}
          {actions}
        </div>
      )}
    </div>
  );
}

export interface SearchFieldProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
  id?: string;
}

/** Search box that submits on Enter or after a short pause. */
export function SearchField({ value, onChange, placeholder = 'Search…', label = 'Search', id = 'filter-search' }: SearchFieldProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  useEffect(() => {
    if (draft === value) return;
    const timer = setTimeout(() => onChange(draft.trim()), 400);
    return () => clearTimeout(timer);
  }, [draft, value, onChange]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    onChange(draft.trim());
  };

  return (
    <form className="field field-search" onSubmit={submit}>
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <input id={id} type="search" className="input" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={placeholder} />
    </form>
  );
}

export interface FilterSelectProps {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  /** Label of the empty option (default "All"). */
  allLabel?: string;
}

export function FilterSelect({ id, label, value, onChange, options, allLabel = 'All' }: FilterSelectProps) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">{allLabel}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
