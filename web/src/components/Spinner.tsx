export interface SpinnerProps {
  size?: 'sm' | 'md';
  label?: string;
}

export function Spinner({ size = 'md', label = 'Loading' }: SpinnerProps) {
  return <span className={size === 'sm' ? 'spinner spinner-sm' : 'spinner'} role="status" aria-label={label} />;
}

export interface LoadingStateProps {
  label?: string;
  /** Compact horizontal variant for inline placement. */
  inline?: boolean;
}

export function LoadingState({ label = 'Loading…', inline = false }: LoadingStateProps) {
  return (
    <div className={inline ? 'loading-state loading-state-inline' : 'loading-state'}>
      <Spinner label={label} />
      <span aria-hidden="true">{label}</span>
    </div>
  );
}

/** Full-viewport loading indicator (session bootstrap, lazy route chunks). */
export function LoadingScreen() {
  return (
    <div className="loading-state" style={{ minHeight: '60vh' }}>
      <Spinner label="Loading" />
      <span aria-hidden="true">Loading…</span>
    </div>
  );
}
