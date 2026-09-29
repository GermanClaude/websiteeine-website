import { useEffect, type ReactNode } from 'react';
import { Link } from 'react-router';

export const APP_NAME = 'SCP:SL Trust Network';

export interface Breadcrumb {
  label: string;
  to?: string;
}

export interface PageHeaderProps {
  title: ReactNode;
  /** Plain-text title for the browser tab (defaults to `title` when it is a string). */
  documentTitle?: string;
  subtitle?: ReactNode;
  actions?: ReactNode;
  breadcrumbs?: readonly Breadcrumb[];
  /** Badges rendered next to the title. */
  badges?: ReactNode;
}

export function PageHeader({ title, documentTitle, subtitle, actions, breadcrumbs, badges }: PageHeaderProps) {
  const tabTitle = documentTitle ?? (typeof title === 'string' ? title : undefined);
  useEffect(() => {
    if (tabTitle === undefined) return;
    const previous = document.title;
    document.title = `${tabTitle} · ${APP_NAME}`;
    return () => {
      document.title = previous;
    };
  }, [tabTitle]);

  return (
    <header className="page-header">
      <div>
        {breadcrumbs !== undefined && breadcrumbs.length > 0 && (
          <nav aria-label="Breadcrumb">
            <ol className="breadcrumbs">
              {breadcrumbs.map((crumb, index) => (
                <li key={`${crumb.label}-${index}`}>{crumb.to !== undefined ? <Link to={crumb.to}>{crumb.label}</Link> : crumb.label}</li>
              ))}
            </ol>
          </nav>
        )}
        <h1 className="page-title">
          {title}
          {badges}
        </h1>
        {subtitle !== undefined && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions !== undefined && <div className="page-actions">{actions}</div>}
    </header>
  );
}
