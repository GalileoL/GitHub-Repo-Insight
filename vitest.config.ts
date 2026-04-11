import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.ts', 'test/**/*.test.tsx'],
    globals: true,
    coverage: {
      reporter: ['text', 'lcov'],
    },
    environmentMatchGlobs: [
      ['test/unit/lib/**/*.test.ts', 'node'],
    ],
  },
});
