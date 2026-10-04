import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// Hermetic suite: no network, no EDGAR_IDENTITY, no LibreOffice, no Python venv.
// This is the default `npm test` and the only suite CI runs on pull requests.
//
// `include` is overridden by spread, not mergeConfig: mergeConfig concatenates
// arrays, which would union this with the base `src/**/*.test.ts` and pull the
// live suites back in.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['src/**/*.unit.test.ts'],
  },
});
