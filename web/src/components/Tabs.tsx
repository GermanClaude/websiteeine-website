import type { KeyboardEvent, ReactNode } from 'react';

export interface TabItem<Id extends string = string> {
  id: Id;
  label: ReactNode;
  count?: number | null;
  disabled?: boolean;
}

export interface TabsProps<Id extends string = string> {
  tabs: readonly TabItem<Id>[];
  value: Id;
  onChange: (id: Id) => void;
  /** Accessible name of the tab list. */
  label?: string;
  /** Id prefix for `aria-controls` / `TabPanel`. */
  idPrefix?: string;
}

export function tabPanelId(prefix: string, id: string): string {
  return `${prefix}-panel-${id}`;
}

export function Tabs<Id extends string = string>({ tabs, value, onChange, label = 'Sections', idPrefix = 'tabs' }: TabsProps<Id>) {
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const enabled = tabs.filter((tab) => tab.disabled !== true);
    const index = enabled.findIndex((tab) => tab.id === value);
    if (index < 0) return;
    let next: number | null = null;
    if (event.key === 'ArrowRight') next = (index + 1) % enabled.length;
    if (event.key === 'ArrowLeft') next = (index - 1 + enabled.length) % enabled.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = enabled.length - 1;
    if (next === null) return;
    event.preventDefault();
    const target = enabled[next];
    if (target !== undefined) {
      onChange(target.id);
      const button = event.currentTarget.querySelector<HTMLButtonElement>(`[data-tab-id="${target.id}"]`);
      button?.focus();
    }
  };

  return (
    <div className="tabs" role="tablist" aria-label={label} onKeyDown={onKeyDown}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            className="tab"
            id={`${idPrefix}-tab-${tab.id}`}
            data-tab-id={tab.id}
            aria-selected={selected}
            aria-controls={tabPanelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            disabled={tab.disabled}
            onClick={() => onChange(tab.id)}
          >
            {tab.label}
            {tab.count !== undefined && tab.count !== null && <span className="tab-count">{tab.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface TabPanelProps {
  id: string;
  idPrefix?: string;
  children: ReactNode;
}

export function TabPanel({ id, idPrefix = 'tabs', children }: TabPanelProps) {
  return (
    <div role="tabpanel" id={tabPanelId(idPrefix, id)} aria-labelledby={`${idPrefix}-tab-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}
