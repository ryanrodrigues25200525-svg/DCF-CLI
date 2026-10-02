import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { BackendApiClient } from '@/api/backend-client';
import { LocalBackendProcess } from '@/infrastructure/local-backend-process';
import { REPORT_FORMS, resolveMonitorFiling, selectLatestFiling } from '@/watch/source-sync';

const ticker = 'AAPL';
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

if (!process.env.EDGAR_IDENTITY?.trim()) {
  throw new Error('Set EDGAR_IDENTITY to your name and email before running this live SEC check.');
}

const home = await mkdtemp(join(tmpdir(), 'dcf-live-filing-agent-'));
const backend = new LocalBackendProcess({
  backendDirectory: resolve(projectRoot, 'backend'),
  environment: {
    ...process.env,
    HOME: home,
    DCF_CACHE_DB_PATH: join(home, 'financial_cache.sqlite'),
  },
});

try {
  const client = new BackendApiClient(await backend.start());
  const [unified, filings] = await Promise.all([
    client.getUnifiedCompany(ticker, 5),
    client.getRecentFilings(ticker, 50),
  ]);
  const issuerCik = String(unified.profile?.cik ?? '').replace(/\D/g, '').padStart(10, '0');
  assert.notEqual(issuerCik, '0000000000', 'Live AAPL profile must include its SEC CIK.');

  const agentSubmittedReports = filings.filings.filter((filing) =>
    REPORT_FORMS.has(filing.form.toUpperCase())
    && filing.accession.slice(0, 10) !== issuerCik);
  const agentReport = selectLatestFiling(agentSubmittedReports);
  if (!agentReport) {
    console.warn(`SKIP ${ticker}: no report-form filing-agent accession in the live SEC response.`);
  } else {
    const earlierIssuerReports = filings.filings.filter((filing) =>
      REPORT_FORMS.has(filing.form.toUpperCase())
      && filing.accession.slice(0, 10) === issuerCik
      && filing.filingDate < agentReport.filingDate);
    const issuerReport = selectLatestFiling(earlierIssuerReports);
    if (!issuerReport) {
      console.warn(`SKIP ${ticker}: no earlier issuer-submitted report is available to form a mixed live filing list.`);
    } else {
      const mixedReports = [agentReport, issuerReport];
      const expected = selectLatestFiling(mixedReports);
      assert.equal(expected?.accession, agentReport.accession, 'The filing-agent report must be the newest report in the live sample.');
      const resolved = resolveMonitorFiling({...filings, filings: mixedReports}, issuerCik, ticker);
      assert.equal(
        resolved.latest?.accession,
        expected.accession,
        'The issuer filings endpoint already scopes these report rows; the accession prefix is the submitting account CIK, not an issuer check.',
      );
      console.log(`PASS ${ticker}: selected filing-agent accession ${resolved.latest.accession} from a mixed live SEC filing list.`);
    }
  }
} finally {
  await backend.stop();
  await rm(home, {recursive: true, force: true});
}
