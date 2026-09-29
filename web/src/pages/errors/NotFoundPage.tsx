import { Link } from 'react-router';

import { PageHeader } from '../../components/PageHeader';

export function NotFoundPage() {
  return (
    <div className="error-page">
      <PageHeader title="Page not found" documentTitle="Not found" />
      <div className="error-page-code" aria-hidden="true">
        404
      </div>
      <p className="text-muted">The page you are looking for does not exist or has moved.</p>
      <p>
        <Link to="/">Back to the dashboard</Link>
      </p>
    </div>
  );
}

export default NotFoundPage;
