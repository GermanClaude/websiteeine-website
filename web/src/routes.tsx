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

import { Permission } from '@scpsl-trust/shared';

import { RequireAuth } from './auth/RequireAuth';
import { RequirePermission } from './auth/RequirePermission';
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
  { path: 'tools/proof', lazy: lazyPage(() => import('./pages/proof/ProofPage')) },
  { path: 'proof', lazy: lazyPage(() => import('./pages/proof/ProofPage')) },
  { path: 'tools/case-lookup', lazy: lazyPage(() => import('./pages/public/PublicCaseLookupPage')) },
  // public case routes (/public/cases/:caseNumber)
  { path: 'public/cases', lazy: lazyPage(() => import('./pages/public/PublicCaseLookupPage')) },
  { path: 'public/cases/:caseNumber', lazy: lazyPage(() => import('./pages/public/PublicCasePage')) },
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
  {
    element: <RequirePermission permission={Permission.CASE_VIEW_STAFF} allowIf={(auth) => auth.hasServerMembership} />,
    children: [{ path: 'cases', lazy: lazyPage(() => import('./pages/cases/CaseListPage')) }],
  },
  // The case page itself is open to every signed-in user: it falls back to the public view on 403 (e.g. the reported player following a link).
  { path: 'cases/:caseNumber', lazy: lazyPage(() => import('./pages/cases/CaseDetailPage')) },

  // reports routes
  { path: 'reports', lazy: lazyPage(() => import('./pages/reports/ReportListPage')) },
  { path: 'reports/new', lazy: lazyPage(() => import('./pages/reports/ReportNewPage')) },
  { path: 'reports/:id', lazy: lazyPage(() => import('./pages/reports/ReportDetailPage')) },

  // evidence routes
  {
    element: <RequirePermission permission={Permission.EVIDENCE_VIEW} />,
    children: [{ path: 'evidence', lazy: lazyPage(() => import('./pages/evidence/EvidenceListPage')) }],
  },
  // Evidence detail is also readable by the uploader and the uploader server's team (the backend decides).
  { path: 'evidence/:id', lazy: lazyPage(() => import('./pages/evidence/EvidenceDetailPage')) },

  // appeals routes (everyone sees their own appeals; appeal:decide sees all)
  { path: 'appeals', lazy: lazyPage(() => import('./pages/appeals/AppealListPage')) },
  { path: 'appeals/new', lazy: lazyPage(() => import('./pages/appeals/AppealNewPage')) },
  { path: 'appeals/:id', lazy: lazyPage(() => import('./pages/appeals/AppealDetailPage')) },

  // players routes
  {
    element: <RequirePermission permission={Permission.PLAYER_VIEW_STAFF} />,
    children: [{ path: 'players', lazy: lazyPage(() => import('./pages/players/PlayerSearchPage')) }],
  },
  // Player page: public view for everyone with a session; the backend adds the staff view with player:view_staff.
  { path: 'players/:userId', lazy: lazyPage(() => import('./pages/players/PlayerDetailPage')) },

  // overwatch routes
  {
    element: <RequirePermission permission={Permission.OVERWATCH_VIEW} />,
    children: [
      { path: 'overwatch', lazy: lazyPage(() => import('./pages/overwatch/OverwatchListPage')) },
      { path: 'overwatch/:id', lazy: lazyPage(() => import('./pages/overwatch/OverwatchDetailPage')) },
    ],
  },

  // servers routes (server-team membership, server:create or server:manage_any)
  {
    element: <RequirePermission permission={[Permission.SERVER_CREATE, Permission.SERVER_MANAGE_ANY]} allowIf={(auth) => auth.hasServerMembership} />,
    children: [
      { path: 'servers', lazy: lazyPage(() => import('./pages/servers/ServerListPage')) },
      { path: 'servers/:serverId', lazy: lazyPage(() => import('./pages/servers/ServerDetailPage')) },
    ],
  },
  {
    element: <RequirePermission permission={Permission.SERVER_CREATE} />,
    children: [{ path: 'servers/new', lazy: lazyPage(() => import('./pages/servers/ServerCreatePage')) }],
  },

  // whitelist routes (players request, server teams decide)
  { path: 'whitelist-requests', lazy: lazyPage(() => import('./pages/whitelist/WhitelistRequestsPage')) },

  // admin routes (users, audit, global bypasses)
  {
    element: <RequirePermission permission={Permission.USER_VIEW} />,
    children: [{ path: 'admin/users', lazy: lazyPage(() => import('./pages/admin/AdminUsersPage')) }],
  },
  {
    element: <RequirePermission permission={Permission.AUDIT_VIEW} />,
    children: [{ path: 'admin/audit', lazy: lazyPage(() => import('./pages/admin/AdminAuditPage')) }],
  },
  {
    element: <RequirePermission permission={Permission.BYPASS_MANAGE_GLOBAL} />,
    children: [{ path: 'admin/bypasses', lazy: lazyPage(() => import('./pages/admin/AdminBypassesPage')) }],
  },

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
