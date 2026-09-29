import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@scpsl-trust/shared': fileURLToPath(new URL('../shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests use real PostgreSQL/Redis; each test file gets its own
    // database (tests/helpers/test-db.ts), so files may run in parallel.
    pool: 'forks',
    maxWorkers: 4,
  },
});
