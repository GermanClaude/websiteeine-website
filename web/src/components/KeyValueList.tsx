import type { ReactNode } from 'react';

export interface KeyValueItem {
  key?: string;
  label: ReactNode;
  value: ReactNode;
}

export interface KeyValueListProps {
  items: readonly KeyValueItem[];
  className?: string;
}

/** Dense definition list for detail panels. */
export function KeyValueList({ items, className }: KeyValueListProps) {
  return (
    <dl className={['kv', className ?? ''].filter(Boolean).join(' ')}>
      {items.map((item, index) => (
        <div key={item.key ?? index} style={{ display: 'contents' }}>
          <dt className="kv-key">{item.label}</dt>
          <dd className="kv-value">{item.value === null || item.value === undefined || item.value === '' ? <span className="text-faint">—</span> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
