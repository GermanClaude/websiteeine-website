import type { ReactNode } from 'react';

import type { BadgeTone } from './Badge';
import { DateTime, RelativeTime } from './DateTime';
import { EmptyState } from './EmptyState';

export interface TimelineEntry {
  id: string;
  at: string;
  title: ReactNode;
  description?: ReactNode;
  /** e.g. actor label or reviewer pseudonym */
  meta?: ReactNode;
  tone?: BadgeTone;
}

export interface TimelineProps {
  entries: readonly TimelineEntry[];
  emptyTitle?: string;
  /** Show relative times instead of absolute ones. */
  relative?: boolean;
}

/** Vertical history list (case history, audit trail). */
export function Timeline({ entries, emptyTitle = 'No history yet', relative = false }: TimelineProps) {
  if (entries.length === 0) return <EmptyState title={emptyTitle} />;
  return (
    <ol className="timeline">
      {entries.map((entry) => (
        <li key={entry.id} className="timeline-item">
          <span className={['timeline-marker', entry.tone !== undefined ? `timeline-marker-${entry.tone}` : ''].filter(Boolean).join(' ')} aria-hidden="true" />
          <div className="timeline-title">{entry.title}</div>
          <div className="timeline-meta">
            {relative ? <RelativeTime value={entry.at} /> : <DateTime value={entry.at} />}
            {entry.meta !== undefined && <> · {entry.meta}</>}
          </div>
          {entry.description !== undefined && entry.description !== null && entry.description !== '' && (
            <div className="timeline-desc">{entry.description}</div>
          )}
        </li>
      ))}
    </ol>
  );
}
