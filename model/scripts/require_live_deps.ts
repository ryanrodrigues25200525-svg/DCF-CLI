import { findSoffice } from '../src/workbook/xlsx';

// Preflight for `npm run test:live`. The live suites skip themselves when a
// dependency is missing so that a bare `vitest run` never crashes at collection;
// this guard makes an *intended* live run fail loudly instead of reporting a
// misleading pass. Values are never logged.
const missing: string[] = [];

if (!findSoffice()) {
  missing.push('LibreOffice (install it or set SOFFICE_PATH to the soffice executable)');
}

if (!process.env.EDGAR_IDENTITY?.trim()) {
  missing.push('EDGAR_IDENTITY (its value is never logged)');
}

if (missing.length > 0) {
  console.error(`Cannot run the live suite. Missing: ${missing.join('; ')}`);
  console.error('See OPERATIONS.md for the full live-suite setup.');
  process.exit(1);
}
