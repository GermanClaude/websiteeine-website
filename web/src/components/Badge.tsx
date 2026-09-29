import type { ReactNode } from 'react';

export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'accent' | 'muted';

export interface BadgeProps {
  tone?: BadgeTone;
  dot?: boolean;
  title?: string;
  className?: string;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', dot = false, title, className, children }: BadgeProps) {
  const classes = ['badge', `badge-${tone}`, dot ? 'badge-dot' : '', className ?? ''].filter(Boolean).join(' ');
  return (
    <span className={classes} title={title}>
      {children}
    </span>
  );
}
