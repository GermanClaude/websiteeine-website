/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Backend origin the dev server proxies `/api` to (default http://localhost:3000). */
  readonly VITE_API_PROXY_TARGET?: string;
  /** Set to "false" to hide the registration link (backend ALLOW_REGISTRATION=false). */
  readonly VITE_REGISTRATION_ENABLED?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
