/**
 * Route manifest. Page modules are lazy-loaded (one chunk per page).
 *
 * HOW TO ADD AN AREA (e.g. cases):
 *   1. Put pages under `src/pages/<area>/` with a default export per page.
 *   2. Add route entries in the matching `// <area> routes` section below, e.g.
 *        {
 *          element: <RequirePermission permission={Permission.CASE_VIEW_STAFF} allowIf={(a) => a.hasServerMembership} />,
 *          children: [
 *            { path: 'cases', lazy: lazyPage(() => import('./pages/cases/CaseListPage')) },
 *            { path: 'cases/:caseNumber', lazy: lazyPage(() => import('./pages/cases/CaseDetailPage')) },
 *          ],
 *        },
 *      Everything inside `protectedRoutes` already requires a session; wrap in
 *      `<RequirePermission>` for permission-gated pages. Public pages go into `publicRoutes`.
 *   3. Add the sidebar entry in `src/nav.ts` (same section markers).
 */
import { createBrowserRouter, type RouteObject } from 'react-router';

import { RequireAuth } from './auth/RequireAuth';
import { AppLayout, AuthLayout, RootLayout } from './components/Layout';
import { LoadingScreen } from './components/Spinner';
import { ForbiddenPage } from './pages/errors/ForbiddenPage';
import { NotFoundPage } from './pages/errors/NotFoundPage';
import { RouteErrorPage } from './pages/errors/RouteErrorPage';

type PageModule = { default: React.ComponentType };

/** `lazy: lazyPage(() => import('./pages/x/Page'))` — loads the page's default export. */
export function lazyPage(loader: () => Promise<PageModule>): NonNullable<RouteObject['lazy']> {
  return { Component: () => loader().then((module) => module.default) };
}

// ---------------------------------------------------------------------------
// Auth pages (no app shell)
// ---------------------------------------------------------------------------
const authRoutes: RouteObject[] = [
  // auth routes
  { path: 'login', lazy: lazyPage(() => import('./pages/auth/LoginPage')) },
  { path: 'register', lazy: lazyPage(() => import('./pages/auth/RegisterPage')) },
  { path: 'verify-email', lazy: lazyPage(() => import('./pages/auth/VerifyEmailPage')) },
  { path: 'forgot-password', lazy: lazyPage(() => import('./pages/auth/ForgotPasswordPage')) },
  { path: 'reset-password', lazy: lazyPage(() => import('./pages/auth/ResetPasswordPage')) },
];

// ---------------------------------------------------------------------------
// Public pages inside the app shell (no session required)
// ---------------------------------------------------------------------------
const publicRoutes: RouteObject[] = [
  // tools routes (proof verification, public case lookup)
  // public case routes (/public/cases/:caseNumber)
];

// ---------------------------------------------------------------------------
// Protected pages (session required; add <RequirePermission> wrappers per area)
// ---------------------------------------------------------------------------
const protectedRoutes: RouteObject[] = [
  // dashboard routes
  { index: true, lazy: lazyPage(() => import('./pages/dashboard/DashboardPage')) },

  // account routes
  { path: 'account', lazy: lazyPage(() => import('./pages/account/ProfilePage')) },
  { path: 'account/security', lazy: lazyPage(() => import('./pages/account/SecurityPage')) },

  // cases routes

  // reports routes

  // evidence routes

  // appeals routes

  // players routes

  // overwatch routes

  // servers routes

  // whitelist routes

  // admin routes (users, audit, global bypasses)

  { path: 'forbidden', element: <ForbiddenPage /> },
];

export const routes: RouteObject[] = [
  {
    path: '/',
    element: <RootLayout />,
    errorElement: <RouteErrorPage />,
    HydrateFallback: LoadingScreen,
    children: [
      { element: <AuthLayout />, children: authRoutes },
      {
        element: <AppLayout />,
        children: [...publicRoutes, { element: <RequireAuth />, children: protectedRoutes }, { path: '*', element: <NotFoundPage /> }],
      },
    ],
  },
];

export const router = createBrowserRouter(routes);
