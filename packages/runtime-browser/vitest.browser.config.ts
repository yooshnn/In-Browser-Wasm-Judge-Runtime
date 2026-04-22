import { defineConfig } from 'vitest/config';

export default defineConfig({
  publicDir: 'artifacts',
  test: {
    include: ['tests/browser/**/*.test.ts'],
    browser: {
      enabled: true,
      provider: 'playwright',
      instances: [{ browser: 'chromium' }],
    },
    timeout: 120_000,
  },
});
