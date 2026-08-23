/**
 * US Treasury Yield Service
 * Fetches Treasury yields from treasury.gov API
 * Provides risk-free rate data for DCF valuation
 */

export interface TreasuryYield {
  maturity: string;
  yield: number; // Yield as decimal (e.g., 0.046 = 4.6%)
  date: string;
  source: string;
}

export interface YieldCurve {
  date: string;
  yields: {
    '1m': number | null;
    '2m': number | null;
    '3m': number | null;
    '6m': number | null;
    '1y': number | null;
    '2y': number | null;
    '3y': number | null;
    '5y': number | null;
    '7y': number | null;
    '10y': number | null;
    '20y': number | null;
    '30y': number | null;
  };
  source: string;
}

// Cache configuration
const CACHE_DURATION = 1000 * 60 * 60; // 1 hour
let cachedYields: YieldCurve | null = null;
let cacheTimestamp: number = 0;
let inFlightTreasuryPromise: Promise<YieldCurve> | null = null;

// Hard fallbacks if both API and DefaultYields (which is January 2025) are missing
const FALLBACK_RATES = {
  '10y': 0.0425, // 4.25%
  '30y': 0.0445, // 4.45%
};

// Default yields (January 2025 estimates) - used when API is unavailable
export const DEFAULT_YIELDS: YieldCurve = {
  date: new Date().toISOString().split('T')[0],
  yields: {
    '1m': 0.0450,
    '2m': 0.0452,
    '3m': 0.0455,
    '6m': 0.0460,
    '1y': 0.0470,
    '2y': 0.0480,
    '3y': 0.0475,
    '5y': 0.0470,
    '7y': 0.0465,
    '10y': 0.0460,
    '20y': 0.0480,
    '30y': 0.0485,
  },
  source: 'Default (Jan 2025 estimates)'
};

interface TreasuryApiResponse {
  data: Array<{
    record_date: string;
    security_desc: string;
    avg_interest_rate_amt: string;
  }>;
}

/**
 * Fetch Treasury yields from treasury.gov API
 * Uses the Treasury's daily average interest rates endpoint
 * Falls back to cached or default data on error
 */
export async function fetchTreasuryYields(): Promise<YieldCurve> {
  // Check cache
  const now = Date.now();
  if (cachedYields && (now - cacheTimestamp) < CACHE_DURATION) {
    return cachedYields;
  }

  // Deduplicate concurrent fetches
  if (inFlightTreasuryPromise) return inFlightTreasuryPromise;
  inFlightTreasuryPromise = fetchTreasuryYieldsInternal(now);
  try {
    return await inFlightTreasuryPromise;
  } finally {
    inFlightTreasuryPromise = null;
  }
}

async function fetchTreasuryYieldsInternal(now: number): Promise<YieldCurve> {
  try {
    // Primary endpoint: Treasury API for daily treasury rates
    const url = `https://api.fiscaldata.treasury.gov/services/api/fiscal_service/v2/accounting/od/avg_interest_rates?fields=record_date,security_desc,avg_interest_rate_amt&filter=record_date:gte:2024-01-01&sort=-record_date&page[size]=100`;

    const response = await fetch(url, {
      headers: {
        'Accept': 'application/json',
      },
      // Cache 1 hour on Next.js fetch layer when running server-side
      next: { revalidate: 3600 } as unknown as RequestInit["cache"],
      signal: AbortSignal.timeout(8000),
    } as RequestInit);

    if (!response.ok) {
      throw new Error(`Treasury API error: ${response.status}`);
    }

    const data = await response.json() as TreasuryApiResponse;
    const yields = parseTreasuryJson(data);

    // Update cache
    cachedYields = yields;
    cacheTimestamp = now;

    console.warn('[Treasury Service] Fetched fresh yields from treasury.gov');
    return yields;
  } catch (error) {
    console.error('[Treasury Service] Error fetching treasury yields:', error);

    // Return cached data if available, otherwise defaults
    if (cachedYields) {
      console.warn('[Treasury Service] Using stale cached data');
      return cachedYields;
    }

    console.warn('[Treasury Service] Using default yields');
    return DEFAULT_YIELDS;
  }
}

/**
 * Parse Treasury JSON data from fiscaldata.treasury.gov API
 */
function parseTreasuryJson(data: TreasuryApiResponse): YieldCurve {
  // Initialize yields with null
  const yields: YieldCurve['yields'] = {
    '1m': null, '2m': null, '3m': null, '6m': null,
    '1y': null, '2y': null, '3y': null, '5y': null,
    '7y': null, '10y': null, '20y': null, '30y': null,
  };

  let latestDate = new Date().toISOString().split('T')[0];

  if (data && data.data && Array.isArray(data.data)) {
    // Sort by date descending to get most recent
    const sorted = [...data.data].sort((a, b) =>
      new Date(b.record_date).getTime() - new Date(a.record_date).getTime()
    );

    if (sorted.length > 0) {
      latestDate = sorted[0].record_date;
    }

    // Group by security type and get the most recent rate for each
    const latestRates = new Map<string, number>();

    for (const item of sorted) {
      const security = item.security_desc;
      const rate = parseFloat(item.avg_interest_rate_amt);

      if (!isNaN(rate) && !latestRates.has(security)) {
        latestRates.set(security, rate / 100); // Convert percentage to decimal
      }
    }

    // Map the rates to our yield curve structure
    const treasuryBillsRate = latestRates.get('Treasury Bills');
    const treasuryNotesRate = latestRates.get('Treasury Notes');
    const treasuryBondsRate = latestRates.get('Treasury Bonds');
    const tipsRate = latestRates.get('Treasury Inflation-Protected Securities (TIPS)');

    if (treasuryBillsRate) {
      yields['1m'] = treasuryBillsRate;
      yields['2m'] = treasuryBillsRate * 1.01;
      yields['3m'] = treasuryBillsRate * 1.02;
      yields['6m'] = treasuryBillsRate * 1.03;
    }

    if (treasuryNotesRate) {
      yields['1y'] = treasuryNotesRate * 0.95;
      yields['2y'] = treasuryNotesRate;
      yields['3y'] = treasuryNotesRate * 1.02;
      yields['5y'] = treasuryNotesRate * 1.05;
      yields['7y'] = treasuryNotesRate * 1.08;
    }

    if (treasuryBondsRate) {
      yields['10y'] = treasuryBondsRate;
      yields['20y'] = treasuryBondsRate * 1.05;
      yields['30y'] = treasuryBondsRate * 1.08;
    } else if (tipsRate) {
      yields['10y'] = tipsRate;
      yields['20y'] = tipsRate * 1.05;
      yields['30y'] = tipsRate * 1.08;
    }
  }

  const result: YieldCurve = {
    date: latestDate,
    yields: {
      '1m': yields['1m'] ?? DEFAULT_YIELDS.yields['1m']!,
      '2m': yields['2m'] ?? DEFAULT_YIELDS.yields['2m']!,
      '3m': yields['3m'] ?? DEFAULT_YIELDS.yields['3m']!,
      '6m': yields['6m'] ?? DEFAULT_YIELDS.yields['6m']!,
      '1y': yields['1y'] ?? DEFAULT_YIELDS.yields['1y']!,
      '2y': yields['2y'] ?? DEFAULT_YIELDS.yields['2y']!,
      '3y': yields['3y'] ?? DEFAULT_YIELDS.yields['3y']!,
      '5y': yields['5y'] ?? DEFAULT_YIELDS.yields['5y']!,
      '7y': yields['7y'] ?? DEFAULT_YIELDS.yields['7y']!,
      '10y': yields['10y'] ?? DEFAULT_YIELDS.yields['10y']!,
      '20y': yields['20y'] ?? DEFAULT_YIELDS.yields['20y']!,
      '30y': yields['30y'] ?? DEFAULT_YIELDS.yields['30y']!,
    },
    source: 'US Treasury (fiscaldata.treasury.gov)'
  };

  return result;
}

/**
 * Get the 10-year Treasury yield (most common for DCF valuation)
 */
export async function get10YearYield(): Promise<TreasuryYield> {
  const curve = await fetchTreasuryYields();

  return {
    maturity: '10-year',
    yield: curve.yields['10y'] ?? DEFAULT_YIELDS.yields['10y']!,
    date: curve.date,
    source: curve.source
  };
}

/**
 * Get the 30-year Treasury yield (for long-duration cash flows)
 */
export async function get30YearYield(): Promise<TreasuryYield> {
  const curve = await fetchTreasuryYields();

  return {
    maturity: '30-year',
    yield: curve.yields['30y'] ?? DEFAULT_YIELDS.yields['30y']!,
    date: curve.date,
    source: curve.source
  };
}

/**
 * Get the risk-free rate
 * Defaults to 10-year Treasury yield
 */
export async function getRiskFreeRate(maturity: '10y' | '30y' = '10y'): Promise<number> {
  try {
    const curve = await fetchTreasuryYields();
    const yield_ = curve.yields[maturity];

    if (yield_ === null || yield_ === undefined) {
      return DEFAULT_YIELDS.yields[maturity] ?? FALLBACK_RATES[maturity] ?? 0.046;
    }

    return yield_;
  } catch (error) {
    console.warn(`[Treasury] Failed to get risk-free rate for ${maturity}, using fallback:`, error);
    return DEFAULT_YIELDS.yields[maturity] ?? FALLBACK_RATES[maturity] ?? 0.046;
  }
}

/**
 * Get the full yield curve
 */
export async function getYieldCurve(): Promise<YieldCurve> {
  return fetchTreasuryYields();
}

/**
 * Interpolate yield for a specific maturity
 */
export async function getInterpolatedYield(years: number): Promise<number> {
  const curve = await fetchTreasuryYields();
  const yields = curve.yields;

  const maturities: { [key: string]: number } = {
    '1m': 1 / 12,
    '2m': 2 / 12,
    '3m': 3 / 12,
    '6m': 6 / 12,
    '1y': 1,
    '2y': 2,
    '3y': 3,
    '5y': 5,
    '7y': 7,
    '10y': 10,
    '20y': 20,
    '30y': 30,
  };

  const points = Object.entries(maturities)
    .filter(([key]) => yields[key as keyof typeof yields] !== null)
    .map(([key, mat]) => ({
      maturity: mat,
      yield: yields[key as keyof typeof yields]!
    }))
    .sort((a, b) => a.maturity - b.maturity);

  if (points.length === 0) return 0.046;

  let lower = points[0];
  let upper = points[points.length - 1];

  for (let i = 0; i < points.length - 1; i++) {
    if (points[i].maturity <= years && points[i + 1].maturity >= years) {
      lower = points[i];
      upper = points[i + 1];
      break;
    }
  }

  if (lower.maturity === upper.maturity) {
    return lower.yield;
  }

  const t = (years - lower.maturity) / (upper.maturity - lower.maturity);
  return lower.yield + t * (upper.yield - lower.yield);
}

/**
 * Clear the yield cache
 */
export function clearYieldCache(): void {
  cachedYields = null;
  cacheTimestamp = 0;
  console.warn('[Treasury Service] Cache cleared');
}
