import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    root: './',
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['./test/support/global-setup.ts'],
    setupFiles: ['./test/support/test-env.ts', './test/support/clean-db.ts'],
    // All test files share one test database and clean it before each test.
    fileParallelism: false,
  },
});
