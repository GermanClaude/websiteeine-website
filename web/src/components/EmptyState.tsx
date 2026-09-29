import type { ReactNode } from 'react';

export interface EmptyStateProps {
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ title = 'Nothing here yet', description, action }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <div className="empty-state-title">{title}</div>
      {description !== undefined && <div>{description}</div>}
      {action !== undefined && <div className="mt-2">{action}</div>}
    </div>
  );
}
