import { isRouteErrorResponse, Link, useRouteError } from 'react-router';

import { getErrorMessage } from '../../api/client';
import { ErrorState } from '../../components/ErrorState';
import { NotFoundPage } from './NotFoundPage';

/** Route-level error boundary (render errors, failed lazy imports, thrown responses). */
export function RouteErrorPage() {
  const error = useRouteError();

  if (isRouteErrorResponse(error) && error.status === 404) return <NotFoundPage />;

  const message = isRouteErrorResponse(error) ? `${error.status} ${error.statusText}` : getErrorMessage(error, 'An unexpected error occurred');
  return (
    <div className="error-page">
      <ErrorState error={new Error(message)} title="Something went wrong" onRetry={() => window.location.reload()}>
        <p>
          <Link to="/">Back to the dashboard</Link>
        </p>
      </ErrorState>
    </div>
  );
}

export default RouteErrorPage;
