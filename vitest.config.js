import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/dtask/tests/**/*.test.js'],
    exclude: ['apps/**/e2e/**', 'node_modules/**'],
  },
});
