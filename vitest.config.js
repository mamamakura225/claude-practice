import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['apps/*/tests/**/*.test.js'],
    exclude: ['apps/**/e2e/**', 'node_modules/**'],
  },
});
