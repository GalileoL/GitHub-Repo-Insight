import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'lib/**/*.test.ts'],
    globals: true,
    coverage: {
      reporter: ['text', 'lcov'],
    },
    environmentMatchGlobs: [
      ['lib/**/*.test.ts', 'node'],
    ],
  },
});
