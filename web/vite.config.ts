// Vite config (not part of `tsc --noEmit`: the web package has no @types/node on purpose).
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

const here = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, here, '');
  const apiProxyTarget = env.VITE_API_PROXY_TARGET ?? 'http://localhost:3000';

  return {
    plugins: [react()],
    resolve: {
      alias: {
        // Consume the shared package from source so no prior build is needed.
        '@scpsl-trust/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
      },
    },
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: false,
      target: 'es2022',
    },
  };
});
