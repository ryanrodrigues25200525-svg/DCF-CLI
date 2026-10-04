import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// Offline suite: no network, no EDGAR_IDENTITY. This is the default `npm test`
// and the only suite CI runs on pull requests.
//
// It is not dependency-free despite the *.unit.test.ts name — these tests drive
// real services. The workbook probes shell out to a Python interpreter with
// openpyxl (findBackendPython), and proposal preview/apply recalculates through
// LibreOffice, so apply-service fails closed without soffice. CI installs
// exactly those two and nothing else.
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
