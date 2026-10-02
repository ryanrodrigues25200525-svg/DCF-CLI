/**
 * Bounded, JSON-safe source snapshot of a validated unified company payload.
 *
 * Pure function: no fetching, no valuation math, no filesystem, no network.
 * Input is the `BackendApiClient.getUnifiedCompany` result (shaped like
 * `NativeUnifiedPayload`). Every branch is traversed defensively from
 * `unknown` so missing or misshapen branches yield nulls/empties, never throws.
 */

export interface SourceSnapshot {
  accession: string | null;
  filedDate: string | null;
  snapshot: Record<string, unknown>;
}

const MAX_SNAPSHOT_CHARS = 120000;
const MAX_YEARS = 10;
const MAX_META_KEYS = 40;
const MAX_NATIVE_OBJECT_KEYS = 40;
const MAX_MARKET_STRING_CHARS = 5000;

const PEERS_DEFAULT = 25;
const PEERS_TRIMMED = 10;
const SOURCES_DEFAULT = 5;
const SOURCES_TRIMMED = 2;
const NATIVE_ARRAY_DEFAULT = 100;
const NATIVE_ARRAY_TRIMMED = 25;

const ACCESSION_RE = /\d{10}-\d{2}-\d{6}/;
const DATE_RE = /\d{4}-\d{2}-\d{2}/;
const ACCESSION_KEY_RE = /accession/i;
const FILED_KEY_RE = /filed|filing|acceptance/i;

const NATIVE_EXPLICIT_KEYS: ReadonlySet<string> = new Set([
  'pipeline_assets',
  'issuer_debt_cost_facts',
  'bank',
  'insurance',
  'reit',
  'mortgage_reit',
]);

/** Extra per-source fields copied through only when the backend provides them. */
const SOURCE_PASSTHROUGH_KEYS: readonly string[] = [
  'form',
  'primary_document',
  'document',
  'url',
  'statement',
  'source_statement',
  'row_id',
  'unit',
  'unit_scale',
  'concept',
  'label',
  'reported_value',
  'currency',
  'fiscal_period',
  'report_date',
  'period_end',
  'source_fiscal_year',
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function getRecord(root: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = root[key];
  return isRecord(value) ? value : null;
}

function strOrNull(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function strFromKeys(record: Record<string, unknown>, keys: readonly string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string') return value;
  }
  return null;
}

function scalarOrNull(value: unknown): string | number | boolean | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'bigint') return value.toString();
  return null;
}

function capKeys(record: Record<string, unknown>, maxKeys: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  let count = 0;
  for (const [key, value] of Object.entries(record)) {
    if (count >= maxKeys) break;
    out[key] = value;
    count += 1;
  }
  return out;
}

function isLineLike(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  if (!Object.hasOwn(value, 'value')) return false;
  const sources = value['sources'];
  return sources === undefined || Array.isArray(sources);
}

function snapSource(source: unknown): Record<string, unknown> {
  if (!isRecord(source)) return { accession: null, filed: null };
  const out: Record<string, unknown> = {
    accession: strFromKeys(source, ['accession', 'accession_number', 'accessionNumber']),
    filed: strFromKeys(source, ['filed', 'filing_date', 'filed_date', 'filingDate', 'filedDate']),
  };
  for (const key of SOURCE_PASSTHROUGH_KEYS) {
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (value === null || value === undefined) continue;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = value;
    }
  }
  return out;
}

function snapLine(line: unknown, sourceCap: number): Record<string, unknown> {
  if (!isRecord(line)) return { value: null, source: null, method: null, concept: null, sources: [] };
  const rawSources = Array.isArray(line['sources']) ? line['sources'] : [];
  return {
    value: scalarOrNull(line['value']),
    source: strOrNull(line['source']),
    method: strOrNull(line['method']),
    concept: scalarOrNull(line['concept']),
    sources: rawSources.slice(0, sourceCap).map(snapSource),
  };
}

function snapAnnualBlock(value: unknown, sourceCap: number): unknown {
  if (isLineLike(value)) return snapLine(value, sourceCap);
  if (Array.isArray(value)) return value.slice(0, NATIVE_ARRAY_DEFAULT).map((item) => snapAnnualBlock(item, sourceCap));
  if (isRecord(value)) {
    const out: Record<string, unknown> = {};
    let count = 0;
    for (const [key, item] of Object.entries(value)) {
      if (count >= MAX_NATIVE_OBJECT_KEYS) break;
      out[key] = snapAnnualBlock(item, sourceCap);
      count += 1;
    }
    return out;
  }
  return scalarOrNull(value);
}

function snapAnnual(annual: unknown, sourceCap: number): Array<Record<string, unknown>> {
  if (!Array.isArray(annual)) return [];
  return annual.slice(-MAX_YEARS).map((row) => {
    if (!isRecord(row)) return { year: null, lines: {} };
    const yearValue = row['year'];
    const year = typeof yearValue === 'number' && Number.isFinite(yearValue) ? yearValue : null;
    const lines: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      if (key === 'year') continue;
      lines[key] = snapAnnualBlock(value, sourceCap);
    }
    return { year, lines };
  });
}

function snapNativeRouteFacts(financialsNative: unknown, arrayCap: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isRecord(financialsNative)) return out;
  for (const [key, value] of Object.entries(financialsNative)) {
    if (!NATIVE_EXPLICIT_KEYS.has(key) && !key.endsWith('_facts')) continue;
    if (Array.isArray(value)) out[key] = value.slice(0, arrayCap);
    else if (isRecord(value)) out[key] = capKeys(value, MAX_NATIVE_OBJECT_KEYS);
    else out[key] = scalarOrNull(value);
  }
  return out;
}

function snapCappedStrings(value: unknown, basePath: string, dropped: string[]): Record<string, unknown> {
  if (!isRecord(value)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item === 'string' && item.length > MAX_MARKET_STRING_CHARS) {
      dropped.push(`${basePath}.${key}`);
      continue;
    }
    out[key] = item;
  }
  return out;
}

function pickPeerScalar(peer: Record<string, unknown>, keys: readonly string[]): string | number | boolean | null {
  for (const key of keys) {
    if (!Object.hasOwn(peer, key)) continue;
    const value = peer[key];
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (typeof value === 'bigint') return value.toString();
  }
  return null;
}

function snapPeer(peer: unknown): Record<string, unknown> {
  const empty = {
    ticker: null,
    name: null,
    enterpriseValue: null,
    ebitda: null,
    revenue: null,
    evEbitda: null,
    evRevenue: null,
    price: null,
    currency: null,
  };
  if (!isRecord(peer)) return { ...empty };
  return {
    ticker: pickPeerScalar(peer, ['ticker', 'symbol']),
    name: pickPeerScalar(peer, ['name']),
    enterpriseValue: pickPeerScalar(peer, ['enterpriseValue', 'enterprise_value']),
    ebitda: pickPeerScalar(peer, ['ebitda', 'EBITDA']),
    revenue: pickPeerScalar(peer, ['revenue']),
    evEbitda: pickPeerScalar(peer, ['evEbitda', 'ev_ebitda']),
    evRevenue: pickPeerScalar(peer, ['evRevenue', 'ev_revenue']),
    price: pickPeerScalar(peer, ['price', 'current_price', 'currentPrice']),
    currency: pickPeerScalar(peer, ['currency']),
  };
}

function extractIsoDate(value: string): string | null {
  const match = value.match(DATE_RE);
  if (!match) return null;
  const candidate = match[0];
  return Number.isNaN(Date.parse(candidate)) ? null : candidate;
}

interface FilingCandidate {
  accession: string;
  filedDate: string;
}

function collectFilingCandidates(node: unknown, into: FilingCandidate[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectFilingCandidates(item, into);
    return;
  }
  if (!isRecord(node)) return;
  let accession: string | null = null;
  let accessionFallback: string | null = null;
  let filed: string | null = null;
  let dateFallback: string | null = null;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value !== 'string') continue;
    const accMatch = value.match(ACCESSION_RE);
    if (accMatch) {
      if (ACCESSION_KEY_RE.test(key)) accession = accession ?? accMatch[0];
      accessionFallback = accessionFallback ?? accMatch[0];
    }
    const date = extractIsoDate(value);
    if (date !== null) {
      if (FILED_KEY_RE.test(key)) filed = filed ?? date;
      dateFallback = dateFallback ?? date;
    }
  }
  const pairedAccession = accession ?? accessionFallback;
  const pairedDate = filed ?? dateFallback;
  if (pairedAccession !== null && pairedDate !== null) {
    into.push({ accession: pairedAccession, filedDate: pairedDate });
  }
  for (const value of Object.values(node)) {
    if (typeof value === 'object' && value !== null) collectFilingCandidates(value, into);
  }
}

function pickLatestFiling(unified: Record<string, unknown>): FilingCandidate | null {
  const candidates: FilingCandidate[] = [];
  const canonical = getRecord(unified, 'canonical_financials');
  const annual = canonical !== null ? canonical['annual'] : undefined;
  collectFilingCandidates(annual, candidates);
  collectFilingCandidates(unified['financials_native'], candidates);
  if (candidates.length === 0) return null;
  let latest = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.filedDate > latest.filedDate) latest = candidate;
  }
  return latest;
}

/** Cycle-safe JSON normalization: bigint→string, undefined→null, functions/symbols dropped. */
function jsonNormalize<T>(value: T): T {
  const seen = new Set<object>();
  const text = JSON.stringify(value, (_key, item: unknown) => {
    if (item === undefined) return null;
    if (typeof item === 'function' || typeof item === 'symbol') return undefined;
    if (typeof item === 'bigint') return item.toString();
    if (typeof item === 'object' && item !== null) {
      if (seen.has(item)) return null;
      seen.add(item);
    }
    return item as unknown;
  });
  if (typeof text !== 'string') return null as T;
  return JSON.parse(text) as T;
}

function truncateLongStrings(node: unknown, maxChars: number): unknown {
  if (typeof node === 'string') {
    return node.length > maxChars ? `${node.slice(0, maxChars)}…[truncated]` : node;
  }
  if (Array.isArray(node)) return node.map((item) => truncateLongStrings(item, maxChars));
  if (isRecord(node)) {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(node)) {
      out[key] = truncateLongStrings(value, maxChars);
    }
    return out;
  }
  return node;
}

/** Length of the JSON encoding; 0 only when the value cannot be encoded. */
export function snapshotChars(snapshot: Record<string, unknown>): number {
  try {
    const text = JSON.stringify(snapshot);
    return typeof text === 'string' ? text.length : 0;
  } catch {
    return 0;
  }
}

interface BuildCaps {
  peers: number;
  sourcesPerLine: number;
  nativeArray: number;
}

function buildRawSnapshot(root: Record<string, unknown>, caps: BuildCaps, dropped: string[]): Record<string, unknown> {
  const eligibility = getRecord(root, 'model_eligibility');
  const canonical = getRecord(root, 'canonical_financials');
  const rawYears = canonical !== null && Array.isArray(canonical['years']) ? canonical['years'] : [];
  const years = rawYears.filter(
    (year): year is number => typeof year === 'number' && Number.isFinite(year),
  );
  const rawPeers = Array.isArray(root['peers']) ? root['peers'] : [];
  const dataQuality = getRecord(root, 'data_quality');
  const completeness = root['completeness'];
  const sourceMetadata = getRecord(root, 'source_metadata');
  return {
    route: eligibility !== null ? strOrNull(eligibility['preferred_model']) : null,
    readiness: eligibility !== null ? strOrNull(eligibility['status']) : null,
    company_type: eligibility !== null ? strOrNull(eligibility['company_type']) : null,
    currency: canonical !== null ? strOrNull(canonical['currency']) : null,
    scale: canonical !== null ? strOrNull(canonical['scale']) : null,
    years,
    annual: snapAnnual(canonical !== null ? canonical['annual'] : undefined, caps.sourcesPerLine),
    financials_native: snapNativeRouteFacts(root['financials_native'], caps.nativeArray),
    source_metadata: sourceMetadata !== null ? capKeys(sourceMetadata, MAX_META_KEYS) : {},
    data_quality: dataQuality !== null ? capKeys(dataQuality, MAX_META_KEYS) : {},
    completeness: isRecord(completeness) ? capKeys(completeness, MAX_META_KEYS) : (completeness ?? null),
    market: snapCappedStrings(root['market'], 'market', dropped),
    market_context: snapCappedStrings(root['market_context'], 'market_context', dropped),
    valuation_context: snapCappedStrings(root['valuation_context'], 'valuation_context', dropped),
    peers: rawPeers.slice(0, caps.peers).map(snapPeer),
  };
}

/** Pure bounded snapshot of the unified company payload. Never throws for size. */
export function buildSourceSnapshot(unified: unknown): SourceSnapshot {
  try {
    const root = isRecord(unified) ? unified : {};
    const filing = pickLatestFiling(root);
    const dropped: string[] = [];
    const trimmed: string[] = [];
    let truncated = false;

    const stages: BuildCaps[] = [
      { peers: PEERS_DEFAULT, sourcesPerLine: SOURCES_DEFAULT, nativeArray: NATIVE_ARRAY_DEFAULT },
      { peers: PEERS_TRIMMED, sourcesPerLine: SOURCES_TRIMMED, nativeArray: NATIVE_ARRAY_TRIMMED },
      { peers: 0, sourcesPerLine: 1, nativeArray: 10 },
    ];
    let snapshot = jsonNormalize({
      ...buildRawSnapshot(root, stages[0], dropped),
      _dropped: [...dropped],
      _truncated: false,
      _trimmed: [] as string[],
    });
    if (snapshotChars(snapshot) > MAX_SNAPSHOT_CHARS) {
      truncated = true;
      trimmed.push('peers', 'annual.sources', 'financials_native');
      snapshot = jsonNormalize({
        ...buildRawSnapshot(root, stages[1], dropped),
        _dropped: [...dropped],
        _truncated: true,
        _trimmed: [...trimmed],
      });
    }
    if (snapshotChars(snapshot) > MAX_SNAPSHOT_CHARS) {
      snapshot = jsonNormalize({
        ...buildRawSnapshot(root, stages[2], dropped),
        _dropped: [...dropped],
        _truncated: true,
        _trimmed: [...trimmed],
      });
    }
    if (snapshotChars(snapshot) > MAX_SNAPSHOT_CHARS) {
      if (!trimmed.includes('long_strings')) trimmed.push('long_strings');
      snapshot = jsonNormalize({
        ...(truncateLongStrings(buildRawSnapshot(root, stages[2], dropped), 2000) as Record<string, unknown>),
        _dropped: [...dropped],
        _truncated: true,
        _trimmed: [...trimmed],
      });
    }
    if (truncated && !trimmed.includes('peers')) trimmed.push('peers');
    return {
      accession: filing !== null ? filing.accession : null,
      filedDate: filing !== null ? filing.filedDate : null,
      snapshot,
    };
  } catch {
    const fallback: Record<string, unknown> = {
      route: null,
      readiness: null,
      company_type: null,
      currency: null,
      scale: null,
      years: [],
      annual: [],
      financials_native: {},
      source_metadata: {},
      data_quality: {},
      completeness: null,
      market: {},
      market_context: {},
      valuation_context: {},
      peers: [],
      _dropped: [],
      _truncated: true,
      _trimmed: ['unavailable'],
    };
    return { accession: null, filedDate: null, snapshot: jsonNormalize(fallback) };
  }
}
