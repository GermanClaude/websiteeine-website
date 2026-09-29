import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

export interface ToastInput {
  tone?: ToastTone;
  title?: string;
  message: string;
  /** Milliseconds; default 5000 (8000 for errors). 0 keeps the toast until dismissed. */
  duration?: number;
}

interface Toast extends Required<Pick<ToastInput, 'tone' | 'message'>> {
  id: number;
  title: string | undefined;
}

interface ToastApi {
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
  success: (message: string, title?: string) => number;
  error: (message: string, title?: string) => number;
  info: (message: string, title?: string) => number;
  warning: (message: string, title?: string) => number;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback(
    (input: ToastInput): number => {
      const id = nextId.current++;
      const tone = input.tone ?? 'info';
      const toast: Toast = { id, tone, title: input.title, message: input.message };
      setToasts((current) => [...current.slice(-4), toast]);
      const duration = input.duration ?? (tone === 'error' ? 8000 : 5000);
      if (duration > 0) {
        timers.current.set(
          id,
          setTimeout(() => dismiss(id), duration),
        );
      }
      return id;
    },
    [dismiss],
  );

  const api = useMemo<ToastApi>(
    () => ({
      push,
      dismiss,
      success: (message, title) => push({ tone: 'success', message, title }),
      error: (message, title) => push({ tone: 'error', message, title }),
      info: (message, title) => push({ tone: 'info', message, title }),
      warning: (message, title) => push({ tone: 'warning', message, title }),
    }),
    [push, dismiss],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-region" role="region" aria-label="Notifications" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast-${toast.tone}`} role={toast.tone === 'error' ? 'alert' : 'status'}>
            <div className="toast-message">
              {toast.title !== undefined && <div className="alert-title">{toast.title}</div>}
              {toast.message}
            </div>
            <button type="button" className="icon-btn" aria-label="Dismiss notification" onClick={() => dismiss(toast.id)}>
              <CloseIcon />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const context = useContext(ToastContext);
  if (context === null) throw new Error('useToast must be used within ToastProvider');
  return context;
}

export function CloseIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 5l10 10M15 5L5 15" strokeLinecap="round" />
    </svg>
  );
}
