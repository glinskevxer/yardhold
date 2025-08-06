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
      /**
       * Set a little under where the suite actually sits, so an honest new
       * branch does not turn the build red on the commit that adds it. The
       * branch figure is the loose one on purpose: the last few points are
       * defaulted arguments and impossible guards, and chasing them buys
       * tests that assert the language works.
       */
      thresholds: {
        statements: 98,
        branches: 93,
        functions: 98,
        lines: 98,
      },
    },
  },
});
