import { defineConfig } from 'tsup';

// Migrations are not bundled: they are read at runtime from <package root>/migrations
// (or MIGRATIONS_DIR), see src/db/paths.ts. Dependencies stay external (tsup default).
export default defineConfig({
  entry: ['src/index.ts', 'src/cli/*.ts'],
  outDir: 'dist',
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  sourcemap: true,
  clean: true,
  bundle: true,
  splitting: true,
  dts: false,
});
