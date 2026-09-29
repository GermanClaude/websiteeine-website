import type { ReactNode } from 'react';

import { ApiError, getErrorMessage } from '../api/client';
import { Button } from './Button';

export interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
  /** Compact variant for cards. */
  compact?: boolean;
  children?: ReactNode;
}

/** Shows an API error with its code, message and request id (for support). */
export function ErrorState({ error, title, onRetry, compact = false, children }: ErrorStateProps) {
  const apiError = ApiError.is(error) ? error : null;
  const heading =
    title ??
    (apiError?.isForbidden
      ? 'Not permitted'
      : apiError?.isNotFound
        ? 'Not found'
        : apiError?.isNetworkError
          ? 'Connection problem'
          : 'Something went wrong');

  return (
    <div className="error-state" role="alert" style={compact ? { padding: 'var(--sp-3)' } : undefined}>
      <div className="error-state-title">{heading}</div>
      <div>{getErrorMessage(error)}</div>
      {apiError !== null && (
        <div className="error-state-meta">
          {apiError.code}
          {apiError.status > 0 ? ` · HTTP ${apiError.status}` : ''}
          {apiError.requestId !== null ? ` · request ${apiError.requestId}` : ''}
        </div>
      )}
      {children}
      {onRetry !== undefined && (
        <Button size="sm" onClick={onRetry}>
          Retry
        </Button>
      )}
    </div>
  );
}

export interface FormErrorProps {
  error: unknown;
}

/** Inline alert for a form-level error message. */
export function FormError({ error }: FormErrorProps) {
  if (error === null || error === undefined) return null;
  const apiError = ApiError.is(error) ? error : null;
  return (
    <div className="alert alert-danger form-error" role="alert">
      {typeof error === 'string' ? error : getErrorMessage(error)}
      {apiError?.requestId !== null && apiError?.requestId !== undefined && (
        <div className="text-xs mono" style={{ opacity: 0.8 }}>
          request {apiError.requestId}
        </div>
      )}
    </div>
  );
}
