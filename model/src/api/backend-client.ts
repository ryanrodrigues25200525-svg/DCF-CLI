import type { NativeUnifiedPayload } from '@/core/types';
import type { DcfWorkbookPayload } from '@/services/exporters/excel/types';
import { parseDcfExportPayload, parseUnifiedCompanyResponse } from './contracts';
import { fetchWithTimeout } from '@/infrastructure/fetch-with-timeout';

const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface BackendPort {
  getUnifiedCompany(ticker: string, years: number): Promise<NativeUnifiedPayload>;
  exportDcf(payload: DcfWorkbookPayload): Promise<Uint8Array>;
}

export interface CompanyFiling {
  form: string;
  filingDate: string;
  accession: string;
  /** Backend period_of_report mapped to report date. */
  reportDate: string;
  /** Backend filing url mapped to primary document link. */
  primaryDocument: string;
}

export interface FilingsListResult {
  /** Response-level CIK from the filings endpoint (identity check, not assumed). */
  cik: string;
  ticker: string;
  filings: CompanyFiling[];
}

function parseCompanyFilings(raw: unknown): FilingsListResult {
  if (!isRecord(raw)) throw new Error('Filings response returned invalid JSON.');
  const filings = raw.filings;
  if (!Array.isArray(filings)) throw new Error('Filings response did not contain a filings list.');
  const out: CompanyFiling[] = [];
  for (const item of filings) {
    if (!isRecord(item)) continue;
    const form = item.form;
    const filingDate = item.filing_date;
    const accession = item.accession_number;
    if (typeof form !== 'string' || !form.trim()) continue;
    if (typeof filingDate !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(filingDate.trim())) continue;
    if (typeof accession !== 'string' || !/\d{10}-\d{2}-\d{6}/.test(accession)) continue;
    const reportDate = item.period_of_report;
    const url = item.url;
    out.push({
      form: form.trim(),
      filingDate: filingDate.trim().slice(0, 10),
      accession: accession.trim(),
      reportDate: typeof reportDate === 'string' ? reportDate.trim().slice(0, 10) : '',
      primaryDocument: typeof url === 'string' ? url.trim() : '',
    });
  }
  const cik = raw.cik;
  const ticker = raw.ticker;
  return {
    cik: typeof cik === 'string' ? cik.trim() : '',
    ticker: typeof ticker === 'string' ? ticker.trim().toUpperCase() : '',
    filings: out,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function errorMessage(value: unknown, status: number): string {
  if (isRecord(value)) {
    const error = value.error;
    if (isRecord(error) && typeof error.message === 'string' && error.message.trim()) return error.message;
    if (typeof value.detail === 'string' && value.detail.trim()) return value.detail;
    if (Array.isArray(value.detail)) {
      const messages = value.detail.flatMap((item) => {
        if (!isRecord(item) || typeof item.msg !== 'string') return [];
        const location = Array.isArray(item.loc) ? item.loc.join('.') : '';
        return [`${location ? `${location}: ` : ''}${item.msg}`];
      });
      if (messages.length) return messages.join('; ');
    }
    if (typeof value.message === 'string' && value.message.trim()) return value.message;
  }
  return `Backend request failed (${status}).`;
}

async function responseJson(response: Response, requestName: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    let body: unknown = text;
    try {
      body = text ? JSON.parse(text) as unknown : null;
    } catch {
      // Preserve the HTTP status when the backend returns a non-JSON failure body.
    }
    throw new Error(errorMessage(body, response.status));
  }
  try {
    return text ? JSON.parse(text) as unknown : null;
  } catch {
    throw new Error(`${requestName} returned invalid JSON.`);
  }
}

export class BackendApiClient implements BackendPort {
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;

  constructor(
    baseUrl: string,
    private readonly fetcher: typeof fetch = fetch,
    requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  ) {
    const normalized = baseUrl.trim().replace(/\/+$/, '');
    if (!normalized) throw new Error('Backend base URL is required.');
    if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0) {
      throw new Error('Backend request timeout must be a positive number of milliseconds.');
    }
    this.baseUrl = normalized;
    this.requestTimeoutMs = requestTimeoutMs;
  }

  async getUnifiedCompany(ticker: string, years: number): Promise<NativeUnifiedPayload> {
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!normalizedTicker) throw new Error('Ticker is required for the unified company request.');
    if (!Number.isInteger(years) || years < 1 || years > 10) {
      throw new Error('Financial history years must be an integer between 1 and 10.');
    }
    const url = `${this.baseUrl}/api/company/${encodeURIComponent(normalizedTicker)}/unified/native?years=${years}`;
    const raw = await fetchWithTimeout(
      this.fetcher,
      url,
      undefined,
      this.requestTimeoutMs,
      'Unified company request',
      (response) => responseJson(response, 'Unified company response'),
    );
    return parseUnifiedCompanyResponse(raw);
  }

  async getRecentFilings(ticker: string, limit = 10): Promise<FilingsListResult> {
    const normalizedTicker = ticker.trim().toUpperCase();
    if (!normalizedTicker) throw new Error('Ticker is required for the filings request.');
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw new Error('Filings limit must be an integer between 1 and 50.');
    }
    const url = `${this.baseUrl}/api/company/${encodeURIComponent(normalizedTicker)}/filings?limit=${limit}`;
    const raw = await fetchWithTimeout(
      this.fetcher,
      url,
      undefined,
      this.requestTimeoutMs,
      'Company filings request',
      (response) => responseJson(response, 'Company filings response'),
    );
    return parseCompanyFilings(raw);
  }

  async exportDcf(payload: DcfWorkbookPayload): Promise<Uint8Array> {
    const validated = parseDcfExportPayload(payload);
    return fetchWithTimeout(
      this.fetcher,
      `${this.baseUrl}/api/export/dcf/excel`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validated),
      },
      this.requestTimeoutMs,
      'Workbook export request',
      async (response) => {
        if (!response.ok) {
          const body = await response.text();
          let parsed: unknown = body;
          try {
            parsed = body ? JSON.parse(body) as unknown : null;
          } catch {
            // Keep the original response status if the service did not return JSON.
          }
          throw new Error(errorMessage(parsed, response.status));
        }
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.length < 4 || bytes[0] !== 0x50 || bytes[1] !== 0x4b) {
          throw new Error('The backend returned an invalid Excel workbook.');
        }
        return bytes;
      },
    );
  }
}
