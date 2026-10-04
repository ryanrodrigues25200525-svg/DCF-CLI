import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// Live suite: SEC network access, EDGAR_IDENTITY, LibreOffice, and the backend
// Python venv. Run via `npm run test:live`, which preflights those dependencies
// so an intended live run fails loudly instead of skipping.
//
// `include` is overridden by spread, not mergeConfig: mergeConfig concatenates
// arrays, which would union this with the base `src/**/*.test.ts`.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['src/**/*.live.test.ts'],
  },
});
