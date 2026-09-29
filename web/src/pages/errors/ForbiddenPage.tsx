import { Link } from 'react-router';

import { PageHeader } from '../../components/PageHeader';

export interface ForbiddenPageProps {
  message?: string;
}

export function ForbiddenPage({ message }: ForbiddenPageProps) {
  return (
    <div className="error-page">
      <PageHeader title="Not permitted" documentTitle="Not permitted" />
      <div className="error-page-code" aria-hidden="true">
        403
      </div>
      <p className="text-muted">{message ?? 'Your account does not have permission to view this page.'}</p>
      <p>
        <Link to="/">Back to the dashboard</Link>
      </p>
    </div>
  );
}

export default ForbiddenPage;
