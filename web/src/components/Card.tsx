import type { ReactNode } from 'react';
import { Link } from 'react-router';

export interface CardProps {
  title?: ReactNode;
  /** Right side of the header (buttons, badges). */
  actions?: ReactNode;
  footer?: ReactNode;
  /** Removes the body padding (tables). */
  flush?: boolean;
  className?: string;
  children?: ReactNode;
  id?: string;
}

export function Card({ title, actions, footer, flush = false, className, children, id }: CardProps) {
  return (
    <section id={id} className={['card', className ?? ''].filter(Boolean).join(' ')}>
      {(title !== undefined || actions !== undefined) && (
        <header className="card-header">
          {title !== undefined && <h2 className="card-title">{title}</h2>}
          {actions !== undefined && <div className="row">{actions}</div>}
        </header>
      )}
      <div className={flush ? 'card-body card-body-flush' : 'card-body'}>{children}</div>
      {footer !== undefined && <footer className="card-footer">{footer}</footer>}
    </section>
  );
}

export interface StatCardProps {
  label: string;
  value: number | string | null | undefined;
  /** Link target (the whole card becomes a link). */
  to?: string;
  hint?: ReactNode;
}

/** Dashboard number tile. Null values render as "—". */
export function StatCard({ label, value, to, hint }: StatCardProps) {
  const body = (
    <>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value === null || value === undefined ? '—' : value}</span>
      {hint !== undefined && <span className="stat-hint">{hint}</span>}
    </>
  );
  if (to !== undefined) {
    return (
      <Link to={to} className="card stat-card" aria-label={`${label}: ${value ?? 'not available'}`}>
        {body}
      </Link>
    );
  }
  return <div className="card stat-card">{body}</div>;
}
