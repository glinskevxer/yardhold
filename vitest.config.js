import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    environment: 'node',
    clearMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text-summary', 'lcov'],
      include: ['src/**/*.js'],
      thresholds: {
        statements: 98,
        branches: 94,
        functions: 98,
        lines: 98,
      },
    },
  },
});
