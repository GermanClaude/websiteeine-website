# @scpsl-trust/web

React 19 + Vite + React Router 8 (data router) + TanStack Query 5, plain CSS with design tokens.
The shared package is consumed from source (`@scpsl-trust/shared` → `../shared/src/index.ts`), so no
prior build is needed.

```
pnpm --filter @scpsl-trust/web dev        # http://localhost:5173, /api proxied to VITE_API_PROXY_TARGET
pnpm --filter @scpsl-trust/web typecheck  # tsc --noEmit (src + tests)
pnpm --filter @scpsl-trust/web test       # vitest (jsdom + Testing Library)
pnpm --filter @scpsl-trust/web build      # tsc + vite build → dist/
```

## Layout of `src/`

| Path | Purpose |
|---|---|
| `main.tsx`, `App.tsx` | entry; providers: QueryClient → Theme → Toast → Auth → RouterProvider |
| `routes.tsx` | route manifest (lazy pages). Sections marked `// <area> routes` |
| `nav.ts` | sidebar manifest with permission gates. Sections marked `// <area> nav` |
| `api/client.ts` | fetch wrapper (`api.get/post/put/patch/delete`, `uploadMultipart`, `ApiError`, `buildQueryString`) |
| `api/keys.ts` | `createQueryKeys('<area>')` factory + foundation keys |
| `api/auth.ts`, `api/me.ts`, `api/dashboard.ts` | foundation endpoints |
| `auth/` | `AuthProvider`, `useAuth`, `usePermission`, `RequireAuth`, `RequirePermission`, `MfaEnrollmentGate` |
| `components/` | UI kit (see `components/index.ts` for the full list) |
| `pages/<area>/` | one folder per area, default-exported page components |
| `styles/` | `tokens.css` (light/dark tokens), `base.css`, `components.css` |
| `lib/` | small helpers (`format.ts`, `useCountdown.ts`) |

## Adding an area (e.g. `cases`)

1. `src/api/cases.ts`
   ```ts
   import { CaseListResponseSchema, type CaseListQuery, type CaseListResponse } from '@scpsl-trust/shared';
   import { api } from './client';
   import { createQueryKeys } from './keys';
   export const caseKeys = createQueryKeys('cases');
   export const listCases = (query: Partial<CaseListQuery>) =>
     api.get<CaseListResponse>('/cases', { query, schema: CaseListResponseSchema });
   ```
2. Pages under `src/pages/cases/*.tsx` (default export each).
3. `src/routes.tsx` → in the `// cases routes` section of `protectedRoutes`:
   ```tsx
   {
     element: <RequirePermission permission={Permission.CASE_VIEW_STAFF} allowIf={(a) => a.hasServerMembership} />,
     children: [
       { path: 'cases', lazy: lazyPage(() => import('./pages/cases/CaseListPage')) },
       { path: 'cases/:caseNumber', lazy: lazyPage(() => import('./pages/cases/CaseDetailPage')) },
     ],
   },
   ```
   Public pages (no session) go into `publicRoutes`.
4. `src/nav.ts` → the entry already exists for the planned areas; adjust if paths differ.

## Conventions

* Lists: `useUrlFilters(DEFAULTS)` (module-level constant) keeps filters in the query string;
  `filters.query` is the object to send (`page`, `page_size`, non-empty filters) and to use in
  `caseKeys.list(filters.query)`. Dashboard tiles deep-link with e.g. `/cases?status=open`.
* Forms: `useZodForm({ schema, initialValues, onSubmit })` with shared zod schemas; spread
  `form.field('name')` into `<Input>`; render `<FormError error={form.formError} />`. Thrown
  `ApiError`s with `details[]` are mapped to fields automatically.
* Enum values: `<StatusBadge kind="verdict" value={row.verdict} />` (kinds in `StatusBadge.tsx`).
* Server-scoped actions: gate buttons by the member role returned in the server view using
  `canActOnServer(user.role, server.member_role, 'manage' | 'policy' | 'bypass' | 'confirm' | 'whitelist_decide')`
  from the shared package — not by the global role alone.
* Mutations: `useMutation` + `queryClient.invalidateQueries({ queryKey: xKeys.all })` +
  `useToast().success(...)`; show `getErrorMessage(error)` on failure.
* Never render raw IPs, secrets or private keys. Show key fingerprints (`shortFingerprint`).
