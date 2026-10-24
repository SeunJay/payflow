import { defineConfig } from 'vitest/config';

// unit: no Docker needed. integration (*.int.test.ts): real Postgres 18 and
// Valkey 8 containers, started once per run by @payflow/test-utils.
export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'unit',
          include: ['{apps,packages}/*/src/**/*.test.ts'],
          exclude: ['**/node_modules/**', '**/*.int.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['{apps,packages}/*/src/**/*.int.test.ts'],
          exclude: ['**/node_modules/**'],
          globalSetup: ['./packages/test-utils/src/global-setup.ts'],
          testTimeout: 30_000,
          hookTimeout: 180_000,
        },
      },
    ],
  },
});
