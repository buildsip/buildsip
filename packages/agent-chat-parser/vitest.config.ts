import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/__tests__/**/*.test.ts'],
    exclude: [
      '**/e2e*',
      '**/real-e2e*',
      '**/stress*',
      '**/injection*',
      '**/parsers.test*',
      '**/conversions.test*',
    ],
    testTimeout: 30000,
  },
});
