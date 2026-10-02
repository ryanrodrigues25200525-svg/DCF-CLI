import type { NativeUnifiedPayload } from '@/core/types';
import type { CompanyFiling, FilingsListResult } from '@/api/backend-client';
import { ModelLibrary, utcNow } from '@/library/store';
import { queueUpdateReady } from '@/watch/watch-service';
import { buildSourceSnapshot } from '@/watch/source-snapshot';

/** One filing-sync result. Never includes workbook bytes; never writes workbooks. */
export interface FilingSyncReport {
  ticker: string;
  /** Latest filing from the SEC filings list (or fact inference fallback). */
  accession: string;
  filedDate: string | null;
  form: string | null;
  reportDate: string | null;
  primaryDocument: string | null;
  filingSource: 'filings-list' | 'fact-inference';
  /** Fact-source accession represented by workbook facts (may be an older 10-K). */
  factAccession: string | null;
  factFiledDate: string | null;
  route: string | null;
  readiness: string | null;
  updateReady: boolean;
  acceptedAccession: string | null;
  /** Report-form rows ignored because accession or filing-date metadata is invalid. */
  rejectedRowCount: number;
  /** Filings-endpoint response CIK used for the identity check. */
  responseCik: string;
  snapshotChars: number;
  truncated: boolean;
  fetchedAt: string;
}

export interface FilingSource {
  getUnified(ticker: string): Promise<NativeUnifiedPayload>;
  getFilings(ticker: string, limit?: number): Promise<FilingsListResult>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isValidFiling(filing: CompanyFiling): boolean {
  return Boolean(filing.accession)
    && /^\d{4}-\d{2}-\d{2}$/.test(filing.filingDate)
    && !Number.isNaN(Date.parse(filing.filingDate));
}

/**
 * SEC report forms that may carry the issuer's own disclosures. Owner forms
 * (3/4/5/144) are NEVER model filings — metadata only. Accession prefixes
 * identify the submitting account, which may be a filing agent, so issuer
 * identity is checked against the filings-list response CIK and ticker.
 */
export const REPORT_FORMS = new Set([
  '10-K', '10-K/A', '10-Q', '10-Q/A', '8-K', '8-K/A',
  '20-F', '20-F/A', '40-F', '40-F/A', '6-K', '6-K/A',
  'S-1', 'S-1/A', '424B1', '424B2', '424B3', '424B4', '424B5',
]);

/** Backwards-compatible alias. */
export const FINANCIAL_FORMS = REPORT_FORMS;

function normalizeCik(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const digits = value.replace(/\D/g, '');
  if (!digits) return null;
  return digits.padStart(10, '0');
}

/** Latest filed entry wins; ties broken by accession order. */
export function selectLatestFiling(filings: CompanyFiling[]): CompanyFiling | null {
  const valid = filings.filter(isValidFiling);
  if (valid.length === 0) return null;
  valid.sort((a, b) => {
    if (a.filingDate !== b.filingDate) return a.filingDate < b.filingDate ? 1 : -1;
    return a.accession < b.accession ? 1 : -1;
  });
  return valid[0]!;
}

/**
 * Identity-validated monitor selection. Throws when the list identity itself
 * is suspect (response CIK/ticker mismatch, missing issuer CIK) so the caller
 * retains the unified fact accession without flagging update-ready. Otherwise
 * returns the latest valid report-form row (or null when no valid row exists
 * → fact-inference fallback), plus the count of report-form rows with invalid
 * accession/date metadata. Form 3/4/5/144 rows are never candidates. The
 * accession prefix is not an issuer check: it can identify a filing agent.
 */
export function resolveMonitorFiling(
  list: FilingsListResult,
  issuerCik: string | null,
  requestedTicker: string,
): { latest: CompanyFiling | null; rejectedRowCount: number; responseCik: string } {
  const responseCik = normalizeCik(list.cik) ?? '';
  const issuer = normalizeCik(issuerCik);
  if (!issuer) {
    throw new Error(
      `Filing identity unclear for ${requestedTicker}: unified profile has no usable CIK; ` +
      `retaining fact accession without flagging update-ready.`,
    );
  }
  if (!responseCik || responseCik !== issuer) {
    throw new Error(
      `Filing identity mismatch for ${requestedTicker}: endpoint CIK ${list.cik || '(missing)'} ` +
      `vs profile CIK ${issuerCik}; retaining fact accession without flagging update-ready.`,
    );
  }
  if (list.ticker && list.ticker !== requestedTicker) {
    throw new Error(
      `Filing identity mismatch for ${requestedTicker}: endpoint ticker ${list.ticker}; ` +
      `retaining fact accession without flagging update-ready.`,
    );
  }
  let rejectedRowCount = 0;
  const candidates = list.filings.filter((filing) => {
    if (!REPORT_FORMS.has(filing.form.toUpperCase())) return false;
    if (!isValidFiling(filing)) {
      rejectedRowCount += 1;
      return false;
    }
    return true;
  });
  return {latest: selectLatestFiling(candidates), rejectedRowCount, responseCik};
}

/**
 * Latest valuation-relevant filing: newest financial-form entry. Falls back to
 * the overall latest (e.g. only Form 4s in range) and then to null (caller
 * falls back to fact inference). Never relabels facts; only selects the
 * monitor identity.
 */
export function selectLatestFinancialFiling(filings: CompanyFiling[]): { filing: CompanyFiling; financial: boolean } | null {
  const financial = selectLatestFiling(filings.filter((filing) => FINANCIAL_FORMS.has(filing.form.toUpperCase())));
  if (financial) return {filing: financial, financial: true};
  const overall = selectLatestFiling(filings);
  return overall ? {filing: overall, financial: false} : null;
}

/**
 * Shared source-sync used by CLI filings sync, the polling watcher, and the
 * MCP filings_sync tool. The latest filed accession/date/form for
 * watch/update-ready/latest-filing reporting comes from the SEC filings list
 * (EdgarTools source via GET /financials/{ticker}/filings), NOT from annual
 * fact inference. The normalized snapshot stores that latest-filing block AND
 * keeps every canonical/native fact's own true accession/filing date/form/
 * primary document/statement/units untouched — annual facts are never
 * relabeled as coming from a newer filing. Workbook files are never touched.
 */
export async function syncFilingSnapshot(
  root: string,
  ticker: string,
  source: FilingSource,
  filingsLimit = 50,
): Promise<FilingSyncReport> {
  const normalizedTicker = ticker.trim().toUpperCase();
  if (!/^[A-Z0-9.-]{1,10}$/.test(normalizedTicker)) {
    throw new Error(`Invalid ticker format: ${ticker}`);
  }
  const [unified, filings] = await Promise.all([
    source.getUnified(normalizedTicker),
    source.getFilings(normalizedTicker, filingsLimit),
  ]);
  const fetchedAt = utcNow();
  const built = buildSourceSnapshot(unified);
  const unifiedRecord = asRecord(unified) ?? {};
  const profile = asRecord(unifiedRecord.profile);
  const issuerCik = profile && typeof profile.cik === 'string' ? profile.cik : null;
  // Identity-validated selection: throws on endpoint/profile CIK or ticker
  // mismatch (nothing is flagged update-ready then). Accession prefixes are
  // submitting-account CIKs and may belong to the issuer's filing agent.
  const resolved = resolveMonitorFiling(filings, issuerCik, normalizedTicker);
  const latest = resolved.latest;
  const latestAccession = latest?.accession ?? built.accession;
  if (!latestAccession) {
    throw new Error(`No filed SEC accession found for ${normalizedTicker} in the filings list or unified payload.`);
  }
  const latestFiledDate = latest?.filingDate ?? built.filedDate;
  const snapshot: Record<string, unknown> = {
    ...built.snapshot,
    _ticker: normalizedTicker,
    _fetchedAt: fetchedAt,
    // Latest-filing block is metadata ABOUT the monitor state; per-fact
    // provenance inside annual/financials_native keeps each fact's own filing.
    _latestFiling: latest
      ? {
        accession: latest.accession,
        filedDate: latest.filingDate,
        form: latest.form,
        reportDate: latest.reportDate || null,
        primaryDocument: latest.primaryDocument || null,
        source: 'filings-list' as const,
        responseCik: resolved.responseCik,
      }
      : {
        accession: latestAccession,
        filedDate: latestFiledDate,
        form: null,
        reportDate: null,
        primaryDocument: null,
        source: 'fact-inference' as const,
      },
    _recentFilings: filings.filings.filter(isValidFiling).slice(0, 10).map((filing) => ({
      accession: filing.accession,
      filedDate: filing.filingDate,
      form: filing.form,
      reportDate: filing.reportDate || null,
      primaryDocument: filing.primaryDocument || null,
    })),
  };
  const snapshotJson = JSON.stringify(snapshot);
  const eligibility = asRecord(unifiedRecord.model_eligibility);
  const {updateReady} = queueUpdateReady(
    root,
    normalizedTicker,
    {accession: latestAccession, filedDate: latestFiledDate ?? ''},
    snapshotJson,
  );
  const lib = new ModelLibrary(root);
  try {
    const acceptedAccession = lib.getCompany(normalizedTicker)?.accession ?? null;
    const route = eligibility && typeof eligibility.preferred_model === 'string' ? eligibility.preferred_model : null;
    const readiness = eligibility && typeof eligibility.status === 'string' ? eligibility.status : null;
    return {
      ticker: normalizedTicker,
      accession: latestAccession,
      filedDate: latestFiledDate,
      form: latest?.form ?? null,
      reportDate: latest && latest.reportDate ? latest.reportDate : null,
      primaryDocument: latest && latest.primaryDocument ? latest.primaryDocument : null,
      filingSource: latest ? 'filings-list' : 'fact-inference',
      factAccession: built.accession,
      factFiledDate: built.filedDate,
      route,
      readiness,
      updateReady,
      acceptedAccession,
      rejectedRowCount: resolved.rejectedRowCount,
      responseCik: resolved.responseCik,
      snapshotChars: snapshotJson.length,
      truncated: snapshot._truncated === true,
      fetchedAt,
    };
  } finally {
    lib.close();
  }
}

/** Snapshot age/staleness for filing_latest. Threshold is informational, not a gate. */
export function snapshotStaleness(fetchedAt: string | null, nowMs = Date.now(), staleAfterHours = 24): {
  fetchedAt: string | null;
  ageHours: number | null;
  stale: boolean;
} {
  if (!fetchedAt) return {fetchedAt, ageHours: null, stale: true};
  const parsed = Date.parse(fetchedAt);
  if (Number.isNaN(parsed)) return {fetchedAt, ageHours: null, stale: true};
  const ageHours = Math.max(0, (nowMs - parsed) / 3_600_000);
  return {fetchedAt, ageHours, stale: ageHours > staleAfterHours};
}
