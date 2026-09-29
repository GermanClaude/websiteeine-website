import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { RouterProvider } from 'react-router';

import { ApiError } from './api/client';
import { AuthProvider } from './auth/AuthProvider';
import { ThemeProvider } from './components/ThemeProvider';
import { ToastProvider } from './components/Toasts';
import { router } from './routes';

/** No retries for client errors (4xx); up to two for network / 5xx failures. */
export function shouldRetry(failureCount: number, error: unknown): boolean {
  if (ApiError.is(error) && error.status >= 400 && error.status < 500) return false;
  return failureCount < 2;
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: shouldRetry,
        staleTime: 15_000,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: false,
      },
    },
  });
}

export function App() {
  const [queryClient] = useState(createAppQueryClient);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ToastProvider>
          <AuthProvider>
            <RouterProvider router={router} />
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}

export default App;
