/**
 * Yahoo Finance Market Data Service
 * Fetches real-time market data for comparable companies
 * Uses yahoo-finance2 library
 * STRICT MODE: No Mock Data Fallbacks
 */

import { Logger } from '@/core/logger';
import { ComparableCompany } from '@/core/types';

// Dynamic import of yahoo-finance2 with better error handling
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let mainClient: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let peerClient: any = null;
// let libraryLoaded = false;
let loadError: Error | null = null;

/**
 * Initialize a fresh Yahoo Finance instance
 * separating Main vs Peers allows us to isolate session/crumb failures
 */
async function createYahooInstance(label: string) {
  try {
    const yfModule = await import('yahoo-finance2').catch((e) => {
      throw new Error(`Failed to import yahoo-finance2: ${e.message}`);
    });

    // Handle different import patterns for yahoo-finance2
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const YahooFinanceClass = (yfModule as any).default || (yfModule as any).YahooFinance || (yfModule as any);

    let instance;
    if (typeof YahooFinanceClass === 'function') {
      try {
        instance = new YahooFinanceClass();
      } catch {
        instance = YahooFinanceClass; // Fallback if not instantiable
      }
    } else {
      instance = YahooFinanceClass; // Singleton fallback
    }

    if (instance && typeof instance.setGlobalConfig === 'function') {
      // Unique config per instance if possible (library dependent)
      instance.setGlobalConfig({
        validation: { logErrors: true },
        queue: {
          concurrency: 1,
          timeout: label === 'MAIN' ? 30000 : 45000 // Peers get longer timeout
        }
      });
    }

    Logger.info(`[Yahoo Finance] ${label} API instance initialized.`);
    return instance;
  } catch (error) {
    Logger.error(`[Yahoo Finance] Failed to create ${label} instance:`, error);
    throw error;
  }
}

/**
 * Get the dedicated MAIN company client
 * Priority: HIGH
 */
async function getMainClient() {
  if (mainClient) return mainClient;
  if (loadError) throw loadError;

  try {
    mainClient = await createYahooInstance('MAIN');
    // libraryLoaded = true;
    return mainClient;
  } catch (e) {
    loadError = e as Error;
    throw e;
  }
}

/**
 * Get the dedicated PEERS company client
 * Priority: LOW (Strictly throttled)
 */
async function getPeerClient() {
  if (peerClient) return peerClient;
  // We try to create a separate instance for peers
  try {
    peerClient = await createYahooInstance('PEERS');
    return peerClient;
  } catch (e) {
    Logger.warn('Failed to init peer client, falling back to main', e);
    return getMainClient();
  }
}

/**
 * Reset local library instances
 */
function clearYahooInstances() {
  mainClient = null;
  peerClient = null;
  // libraryLoaded = false;
  loadError = null;
  Logger.info('[Yahoo Finance] ALL Library instances reset (Main & Peers).');
}



export interface MarketData {
  ticker: string;
  name: string;
  price: number;
  marketCap: number;
  beta: number;
  sharesOutstanding: number;
  enterpriseValue: number;
  revenue: number;
  ebitda: number;
  evRevenue: number;
  evEbitda: number;
  peRatio: number | null;
  dividendYield: number | null;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  currency: string;
  sector?: string;
  industry?: string;
  lastUpdated: number;
}

export interface HistoricalPrice {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  adjClose: number;
}

// Global throttling state
let lastRequestTime = 0;
const MAIN_REQUEST_GAP = 500;   // 0.5 second for main company
const PEER_REQUEST_GAP = 1500;  // 1.5 seconds for peers (more conservative)
const pendingRequests = new Map<string, Promise<MarketData | null>>();
const pendingHistoryRequests = new Map<string, Promise<HistoricalPrice[]>>();
let circuitOpen = false;
let circuitResetTime = 0;
let consecutiveFailures = 0;
const BASE_COOLDOWN = 15000; // 15 seconds base
const MAX_COOLDOWN = 300000; // 5 minutes max

// Persistent cache for Market Proxy (SPY) to avoid redundant history calls
let spyHistoryCache: HistoricalPrice[] | null = null;
let spyHistoryLastFetch = 0;
const SPY_CACHE_DURATION = 1000 * 60 * 60 * 24; // 24 hours

/**
 * Throttles requests and checks the circuit breaker status.
 */
async function throttleRequest(isPeer: boolean = false) {
  if (circuitOpen) {
    const now = Date.now();
    const remaining = circuitResetTime - now;

    if (remaining > 0) {
      throw new Error(`Market data API cooling down (IP Blocked). Try again in ${Math.ceil(remaining / 1000)}s`);
    }

    // Half-open state: allow one request to test if it succeeds
    Logger.info('[Yahoo Finance] Circuit half-open, testing recovery...');
    // We don't set circuitOpen = false yet; we wait for success
  }

  const now = Date.now();
  const gap = isPeer ? PEER_REQUEST_GAP : MAIN_REQUEST_GAP;
  const timeSinceLast = now - lastRequestTime;
  if (timeSinceLast < gap) {
    await sleep(gap - timeSinceLast);
  }
  lastRequestTime = Date.now();
}

/**
 * Triggers the 45s cooldown period.
 */
function tripCircuitBreaker() {
  consecutiveFailures++;
  const cooldown = Math.min(
    BASE_COOLDOWN * Math.pow(2, consecutiveFailures - 1),
    MAX_COOLDOWN
  );

  circuitOpen = true;
  circuitResetTime = Date.now() + cooldown;

  Logger.warn(`⚠️ [Yahoo Finance] Rate limit hit! Circuit breaker TRIPPED. Cooling down for ${cooldown / 1000}s (attempt ${consecutiveFailures}).`);
  clearYahooInstances();
}

/**
 * Reset counter and circuit on successful request
 */
function onSuccessfulRequest() {
  if (circuitOpen || consecutiveFailures > 0) {
    Logger.info('[Yahoo Finance] Circuit breaker RESET after successful request.');
  }
  consecutiveFailures = 0;
  circuitOpen = false;
  circuitResetTime = 0;
}

// Cache configuration
const CACHE_DURATIONS = {
  price: 1000 * 60 * 5,        // 5 minutes for price
  fundamentals: 1000 * 60 * 60, // 1 hour for fundamentals
  profile: 1000 * 60 * 60 * 24, // 24 hours for profile/industry
};
const STORAGE_KEY = 'dcf_market_data_cache';

const marketDataCache: Map<string, { data: MarketData; timestamp: number }> = new Map();
const historicalCache: Map<string, { data: HistoricalPrice[]; timestamp: number }> = new Map();

/**
 * Persist cache to localStorage
 */
function persistCache() {
  if (typeof window === 'undefined') return;
  try {
    const cacheData: Record<string, { data: MarketData; timestamp: number }> = {};
    marketDataCache.forEach((value, key) => {
      // Only persist data from the last 7 days
      if (Date.now() - value.timestamp < 1000 * 60 * 60 * 24 * 7) {
        cacheData[key] = value;
      }
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(cacheData));
  } catch (e) {
    Logger.warn('[Yahoo Finance] Failed to persist cache:', e);
  }
}

/**
 * Load cache from localStorage
 */
function loadPersistedCache() {
  if (typeof window === 'undefined') return;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const data = JSON.parse(stored);
      Object.entries(data).forEach(([key, value]) => {
        marketDataCache.set(key, value as { data: MarketData; timestamp: number });
      });
      Logger.info(`[Yahoo Finance] Restored ${marketDataCache.size} items from local storage.`);
    }
  } catch (e) {
    Logger.warn('[Yahoo Finance] Failed to load cache:', e);
  }
}

// Initialize cache on load
if (typeof window !== 'undefined') {
  loadPersistedCache();
}

/**
 * Helper to sleep for a bit
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Helper to extract raw value from Yahoo's { raw, fmt } objects
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function val(obj: any): any {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === 'object' && 'raw' in obj) return obj.raw;
  return obj;
}

interface YahooQuote {
  symbol: string;
  regularMarketPrice?: number;
  sharesOutstanding?: number;
  marketCap?: number;
  enterpriseValue?: number;
  longName?: string;
  shortName?: string;
  beta?: number;
  trailingPE?: number;
  dividendYield?: number;
  fiftyTwoWeekHigh?: number;
  fiftyTwoWeekLow?: number;
  currency?: string;
  sector?: string;
  industry?: string;
  [key: string]: unknown;
}

interface YahooFundamentals {
  financialData?: {
    totalRevenue?: number;
    ebitda?: number;
    [key: string]: unknown;
  };
  defaultKeyStatistics?: {
    sharesOutstanding?: number;
    enterpriseValue?: number;
    beta?: number;
    trailingPE?: number;
    dividendYield?: number;
    [key: string]: unknown;
  };
  summaryProfile?: {
    sector?: string;
    industry?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Fetch real-time market data for a ticker with retries
 * @param isDeep - If true, fetches full fundamentals (revenue, ebitda, sector). 
 *                 If false, fetches only basic quote data (price, market cap).
 */
export async function fetchMarketData(ticker: string, isDeep = true): Promise<MarketData | null> {
  const cacheKey = `${ticker.toUpperCase()}:${isDeep ? 'DEEP' : 'SHALLOW'}`;

  // 1. Request Deduplication
  if (pendingRequests.has(cacheKey)) {
    Logger.debug(`[Yahoo Finance] Deduplicating request for ${ticker} (${isDeep ? 'DEEP' : 'SHALLOW'})`);
    return pendingRequests.get(cacheKey)!;
  }

  const promise = fetchMarketDataInternal(ticker, isDeep);
  pendingRequests.set(cacheKey, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    pendingRequests.delete(cacheKey);
  }
}

/**
 * Internal fetching logic without deduplication
 */
async function fetchMarketDataInternal(ticker: string, isDeep = true): Promise<MarketData | null> {
  const tickerKey = ticker.toUpperCase();
  const now = Date.now();

  // Check cache with tiered durations
  const cached = marketDataCache.get(tickerKey);
  if (cached) {
    const age = now - cached.timestamp;
    const duration = isDeep ? CACHE_DURATIONS.fundamentals : CACHE_DURATIONS.price;
    if (age < duration) {
      return cached.data;
    }
    Logger.debug(`[Yahoo Finance] Cache expired for ${tickerKey} (${Math.ceil(age / 60000)}m old)`);
  }

  try {
    // 1. Enforce Throttle/Circuit Breaker (Main request)
    await throttleRequest(false);

    // 2. Use MAIN Client
    const yf = await getMainClient();

    let quote: YahooQuote | null = null;
    let fundamentals: YahooFundamentals | null = null;
    let attempts = 0;
    const MAX_RETRIES = 2; // Total 3 attempts

    while (attempts <= MAX_RETRIES) {
      try {
        if (isDeep) {
          // CONSOLIDATED CALL: Get everything in one single request
          try {
            const result = await yf.quoteSummary(ticker, {
              modules: ['price', 'financialData', 'defaultKeyStatistics', 'summaryProfile']
            }) as unknown as YahooFundamentals;

            Logger.debug(`[Yahoo Finance] Data received for ${ticker}:`, {
              hasPrice: !!result.price,
              hasFinancials: !!result.financialData,
              hasStats: !!result.defaultKeyStatistics
            });

            fundamentals = result as YahooFundamentals;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const p = (result as any).price || {};
            quote = {
              symbol: p.symbol || ticker,
              regularMarketPrice: val(p.regularMarketPrice),
              marketCap: val(p.marketCap),
              longName: p.longName,
              shortName: p.shortName,
              currency: p.currency,
              exchangeName: p.exchangeName,
              sharesOutstanding: val(result.defaultKeyStatistics?.sharesOutstanding),
              enterpriseValue: val(result.defaultKeyStatistics?.enterpriseValue),
              beta: val(result.defaultKeyStatistics?.beta),
              trailingPE: val(result.defaultKeyStatistics?.trailingPE),
              dividendYield: val(result.defaultKeyStatistics?.dividendYield),
              fiftyTwoWeekHigh: val(p.fiftyTwoWeekHigh) ?? val(p.regularMarketDayHigh),
              fiftyTwoWeekLow: val(p.fiftyTwoWeekLow) ?? val(p.regularMarketDayLow),
            } as YahooQuote;

            // Success - break loop
            break;

          } catch (err: unknown) {
            const error = err as Error;
            // 404 means ticker not found in summary, try basic quote immediately
            if (error.message?.includes('404') || error.message?.includes('Not Found')) {
              Logger.warn(`[Yahoo Finance] QuoteSummary 404 for ${ticker}, trying basic quote fallback.`);
              throw new Error('FALLBACK_NEEDED');
            }

            // Rate limits - stop immediately
            if (error.message?.includes('429') || error.message?.includes('Too Many Requests')) {
              tripCircuitBreaker();
              throw new Error(`Rate limit hit for ${ticker}.`);
            }

            // Other errors - throw to trigger retry (unless last attempt)
            throw error;
          }
        } else {
          // LIGHT MODE
          quote = await yf.quote(ticker) as unknown as YahooQuote;
          break;
        }
      } catch (err: unknown) {
        const error = err as Error;

        // Handle immediate fallback from Deep -> Light
        if (error.message === 'FALLBACK_NEEDED') {
          try {
            await throttleRequest(false);
            quote = await yf.quote(ticker) as unknown as YahooQuote;
            Logger.info(`[Yahoo Finance] Fallback to basic quote succeeded for ${ticker}`);
            break; // Exit loop on successful fallback
          } catch (fallbackErr) {
            Logger.error(`[Yahoo Finance] Fallback failed for ${ticker}:`, fallbackErr);
            // Continue to retry loop if possible
          }
        }

        attempts++;
        if (attempts > MAX_RETRIES) {
          // If we failed after retries and we were in deep mode, TRY ONE LAST FALLBACK to basic quote
          // This ensures we at least get price/market cap if possible
          if (isDeep && !quote) {
            Logger.warn(`[Yahoo Finance] All retries failed for ${ticker}, attempting final basic quote fallback.`);
            try {
              quote = await yf.quote(ticker) as unknown as YahooQuote;
              break; // Use the basic quote
            } catch { }
          }

          if (!quote) {
            Logger.error(`[Yahoo Finance] Failed to fetch ${ticker} after ${attempts} attempts.`);
            // Only throw if we have absolutely no data
            throw error;
          }
        }

        const delay = 1000 * Math.pow(2, attempts); // 2s, 4s, 8s
        Logger.warn(`[Yahoo Finance] Error fetching ${ticker} (Attempt ${attempts}/${MAX_RETRIES}). Retrying in ${delay / 1000}s... Error: ${error.message}`);
        await sleep(delay);
      }
    }

    if (!quote) return null;

    // Extract metrics with fallbacks
    const price = quote.regularMarketPrice ?? 0;
    // ... logic continues ...
    if (price === 0 && !quote.marketCap) {
      // If we have no price and no market cap, the data is useless
      return null;
    }

    // Use keys from either quote or fundamentals
    const sharesOutstanding = val(quote.sharesOutstanding) ?? val(fundamentals?.defaultKeyStatistics?.sharesOutstanding) ?? 0;

    // STRICT FALLBACK: If Market Cap is missing/zero but we have Price and Shares, calculate it manually
    let marketCap = val(quote.marketCap);
    if ((!marketCap || marketCap === 0) && price > 0 && sharesOutstanding > 0) {
      Logger.warn(`[Yahoo Finance] Market Cap missing for ${ticker}, derived from Price * Shares`);
      marketCap = price * sharesOutstanding;
    }
    marketCap = marketCap ?? 0;

    const enterpriseValue = val(quote.enterpriseValue) ?? val(fundamentals?.defaultKeyStatistics?.enterpriseValue) ?? marketCap;

    const revenue = val(fundamentals?.financialData?.totalRevenue) ?? 0;
    const ebitda = val(fundamentals?.financialData?.ebitda) ?? 0;

    const evRevenue = revenue > 0 ? enterpriseValue / revenue : 0;
    const evEbitda = ebitda > 0 ? enterpriseValue / ebitda : 0;

    let beta = val(quote.beta) ?? val(fundamentals?.defaultKeyStatistics?.beta);

    // Only calculate beta if missing AND we are in deep mode
    if (!beta && !circuitOpen && isDeep) {
      try {
        beta = await calculateBeta(ticker) ?? 1.0;
      } catch { beta = 1.0; }
    }

    const marketData: MarketData = {
      ticker: ticker.toUpperCase(),
      name: quote.longName || quote.shortName || ticker,
      price,
      marketCap,
      beta: beta ?? 1.0,
      sharesOutstanding,
      enterpriseValue,
      revenue,
      ebitda,
      evRevenue,
      evEbitda,
      peRatio: val(quote.trailingPE) ?? val(fundamentals?.defaultKeyStatistics?.trailingPE) ?? null,
      dividendYield: (val(quote.dividendYield) ?? val(fundamentals?.defaultKeyStatistics?.dividendYield) ?? 0) / 100 || null,
      fiftyTwoWeekHigh: val(quote.fiftyTwoWeekHigh) ?? price, // Fallback to current price if missing
      fiftyTwoWeekLow: val(quote.fiftyTwoWeekLow) ?? price,
      currency: quote.currency || 'USD',
      sector: quote.sector || fundamentals?.summaryProfile?.sector,
      industry: quote.industry || fundamentals?.summaryProfile?.industry,
      lastUpdated: now,
    };

    onSuccessfulRequest();
    Logger.info(`[Yahoo Finance] Processed data for ${ticker}: Price=${price}, MC=${marketCap}, Shares=${sharesOutstanding}`);

    marketDataCache.set(tickerKey, { data: marketData, timestamp: now });
    persistCache();
    return marketData;
  } catch (error: unknown) {
    const err = error as Error;
    Logger.error(`[Yahoo Finance] MAIN Error fetching ${ticker}:`, err.message);
    throw err;
  }
}

/**
 * Fetch historical price data
 * USES: MAIN CLIENT (usually)
 */
export async function getHistoricalPrices(ticker: string, period: string = '2y'): Promise<HistoricalPrice[]> {
  const cacheKey = `${ticker.toUpperCase()}_${period}`;

  // 1. Request Deduplication
  if (pendingHistoryRequests.has(cacheKey)) {
    Logger.debug(`[Yahoo Finance] Deduplicating history request for ${ticker} (${period})`);
    return pendingHistoryRequests.get(cacheKey)!;
  }

  const promise = getHistoricalPricesInternal(ticker, period);
  pendingHistoryRequests.set(cacheKey, promise);

  try {
    const result = await promise;
    return result;
  } finally {
    pendingHistoryRequests.delete(cacheKey);
  }
}

/**
 * Internal history fetching logic
 */
async function getHistoricalPricesInternal(ticker: string, period: string = '2y'): Promise<HistoricalPrice[]> {
  // ... (logic remains mostly same, just usesgetMainClient)
  const cacheKey = `${ticker.toUpperCase()}_${period}`;
  const now = Date.now();
  const cached = historicalCache.get(cacheKey);
  if (cached && (now - cached.timestamp) < CACHE_DURATIONS.fundamentals) return cached.data;

  try {
    await throttleRequest(false);
    const yf = await getMainClient(); // History is usually for main company
    if (circuitOpen) return [];

    const interval = period === '1d' || period === '5d' ? '1d' : '1wk';
    const results = await yf.historical(ticker, { period1: period, interval });

    // ... (mapper logic) ...
    const prices: HistoricalPrice[] = (results as Array<Record<string, unknown>>).map((r: Record<string, unknown>) => ({
      date: (r.date as Date).toISOString().split('T')[0],
      open: (r.open as number) ?? 0,
      high: (r.high as number) ?? 0,
      low: (r.low as number) ?? 0,
      close: (r.close as number) ?? 0,
      volume: (r.volume as number) ?? 0,
      adjClose: (r.adjClose as number) ?? (r.close as number) ?? 0,
    }));

    historicalCache.set(cacheKey, { data: prices, timestamp: now });
    onSuccessfulRequest();
    return prices;
  } catch (e) {
    Logger.error(`[Yahoo Finance] History error ${ticker}`, e);
    return [];
  }
}

/**
 * Fetch lightweight peer comparable data
 * USES: PEER CLIENT
 * Now fetches proper fundamentals for valuation multiples
 */
export async function fetchPeerComparables(tickers: string[]): Promise<ComparableCompany[]> {
  if (tickers.length === 0) return [];

  try {
    // 1. Enforce Throttle (Peers request)
    await throttleRequest(true);

    // 2. Use PEER Client
    const yf = await getPeerClient();
    Logger.info(`[Yahoo Finance - PEERS] Fetching fundamentals for: ${tickers.join(', ')}`);

    const results: ComparableCompany[] = [];

    // Fetch each peer with quoteSummary to get fundamentals
    // Process sequentially with delays to avoid rate limiting
    for (const ticker of tickers) {
      if (circuitOpen) break;

      try {
        await sleep(500); // Small delay between requests

        const data = await yf.quoteSummary(ticker, {
          modules: ['price', 'financialData', 'defaultKeyStatistics']
        }) as unknown as { price: any; financialData: any; defaultKeyStatistics: any }; // eslint-disable-line @typescript-eslint/no-explicit-any

        const priceData = data.price || {};
        const financialData = data.financialData || {};
        const statsData = data.defaultKeyStatistics || {};

        const price = val(priceData.regularMarketPrice) ?? 0;
        const marketCap = val(priceData.marketCap) ?? 0;
        const sharesOutstanding = val(statsData.sharesOutstanding) ?? 0;
        const enterpriseValue = val(statsData.enterpriseValue) ?? marketCap;
        const revenue = val(financialData.totalRevenue) ?? 0;
        const ebitda = val(financialData.ebitda) ?? 0;
        const revenueGrowth = val(financialData.revenueGrowth) ?? 0;
        const beta = val(statsData.beta) ?? 1.0;

        // Calculate valuation multiples
        const evRevenue = revenue > 0 ? enterpriseValue / revenue : 0;
        const evEbitda = ebitda > 0 ? enterpriseValue / ebitda : 0;
        const ebitdaMargin = revenue > 0 ? ebitda / revenue : 0;

        results.push({
          ticker: ticker.toUpperCase(),
          name: priceData.longName || priceData.shortName || ticker,
          sector: priceData.sector || 'Unknown',
          industry: priceData.industry || 'Unknown',
          marketCap,
          enterpriseValue,
          evRevenue,
          evEbitda,
          revenue,
          ebitda,
          revenueGrowth,
          ebitdaMargin,
          price,
          beta,
          sharesOutstanding,
          peRatio: val(statsData.trailingPE) ?? undefined,
          currency: priceData.currency || 'USD',
          isSelected: true,
        });

        onSuccessfulRequest();
      } catch (err) {
        const error = err as Error;
        Logger.warn(`[Yahoo Finance - PEERS] Failed to fetch ${ticker}: ${error.message}`);

        if (error.message?.includes('429') || error.message?.includes('crumb')) {
          tripCircuitBreaker();
          break;
        }
        // Continue with other peers even if one fails
        continue;
      }
    }

    Logger.info(`[Yahoo Finance - PEERS] Successfully fetched ${results.length}/${tickers.length} peers`);
    return results.filter(c => (c.price ?? 0) > 0);
  } catch (error) {
    Logger.error(`[Yahoo Finance - PEERS] Error:`, error);
    return [];
  }
}

/**
 * Fetch batch market data for multiple tickers
 * USES: PEER CLIENT
 */
export async function fetchBatchMarketData(tickers: string[]): Promise<(MarketData | null)[]> {
  if (tickers.length === 0) return [];
  if (circuitOpen) return tickers.map(() => null);

  console.warn(`[Yahoo Finance - PEERS] Batch fetching deep data: ${tickers.join(', ')}`);

  const now = Date.now();
  const resultsMap = new Map<string, MarketData | null>();
  const tickersToFetch: string[] = [];

  for (const ticker of tickers) {
    const cacheKey = ticker.toUpperCase();
    const cached = marketDataCache.get(cacheKey);
    if (cached && (now - cached.timestamp) < CACHE_DURATIONS.fundamentals) {
      resultsMap.set(cacheKey, cached.data);
    } else {
      tickersToFetch.push(ticker);
    }
  }

  if (tickersToFetch.length === 0) {
    return tickers.map(t => resultsMap.get(t.toUpperCase()) || null);
  }

  try {
    const yf = await getPeerClient();
    await throttleRequest(true);

    let quotes: YahooQuote[] = [];
    try {
      quotes = await yf.quote(tickersToFetch) as YahooQuote[];
      onSuccessfulRequest();
    } catch (err: unknown) { // ... error handling 
      const error = err as Error;
      if (error.message?.includes('429')) tripCircuitBreaker();
      console.warn(`[Yahoo Peers] Batch quote failed`);
    }

    // ... (Consolidate results) ...
    const quotesMap = new Map<string, YahooQuote>();
    if (Array.isArray(quotes)) {
      quotes.forEach(q => {
        if (q && q.symbol) quotesMap.set(q.symbol.toUpperCase(), q);
      });
    }

    // 3. Complete data LIGHTLY for peers without additional network calls
    for (const ticker of tickersToFetch) {
      if (circuitOpen) break;

      const upperTicker = ticker.toUpperCase();
      const quote = quotesMap.get(upperTicker);

      if (quote) {
        // We already have the quote from the batch call! 
        const marketData = createMarketDataFromQuote(quote, null);
        resultsMap.set(upperTicker, marketData);
        marketDataCache.set(upperTicker, { data: marketData, timestamp: now });
      } else {
        // Only if the batch quote failed for this specific ticker, try one individual fetch
        try {
          // Individual fallbacks are slow/risky, use only if necessary
          if (!circuitOpen) {
            const data = await fetchMarketData(ticker, false);
            resultsMap.set(upperTicker, data);
          }
        } catch {
          resultsMap.set(upperTicker, null);
        }
      }
    }
    persistCache();
  } catch (error) {
    console.error(`[Yahoo Finance - PEERS] Batch Deep Error:`, error);
  }

  return tickers.map(t => resultsMap.get(t.toUpperCase()) || null);
}


/**
 * Helper to create MarketData from just a quote object if summary fails
 */
function createMarketDataFromQuote(quote: YahooQuote, fundamentals: YahooFundamentals | null): MarketData {
  const price = val(quote.regularMarketPrice) ?? 0;
  const sharesOutstanding = val(quote.sharesOutstanding) ?? val(fundamentals?.defaultKeyStatistics?.sharesOutstanding) ?? 0;
  const marketCap = val(quote.marketCap) ?? (price * sharesOutstanding);
  const enterpriseValue = val(quote.enterpriseValue) ?? val(fundamentals?.defaultKeyStatistics?.enterpriseValue) ?? marketCap;

  const revenue = val(fundamentals?.financialData?.totalRevenue) ?? 0;
  const ebitda = val(fundamentals?.financialData?.ebitda) ?? 0;

  return {
    ticker: quote.symbol?.toUpperCase() || '',
    name: quote.longName || quote.shortName || quote.symbol || '',
    price,
    marketCap,
    beta: val(quote.beta) ?? val(fundamentals?.defaultKeyStatistics?.beta) ?? 1.0,
    sharesOutstanding,
    enterpriseValue,
    revenue,
    ebitda,
    evRevenue: revenue > 0 ? enterpriseValue / revenue : 0,
    evEbitda: ebitda > 0 ? enterpriseValue / ebitda : 0,
    peRatio: val(quote.trailingPE) ?? val(fundamentals?.defaultKeyStatistics?.trailingPE) ?? null,
    dividendYield: (val(quote.dividendYield) ?? val(fundamentals?.defaultKeyStatistics?.dividendYield) ?? 0) / 100 || null,
    fiftyTwoWeekHigh: val(quote.fiftyTwoWeekHigh) ?? 0,
    fiftyTwoWeekLow: val(quote.fiftyTwoWeekLow) ?? 0,
    currency: quote.currency || 'USD',
    sector: quote.sector || fundamentals?.summaryProfile?.sector,
    industry: quote.industry || fundamentals?.summaryProfile?.industry,
    lastUpdated: Date.now(),
  };
}

/**
 * Convert MarketData to ComparableCompany format
 */
export function marketDataToComparable(data: MarketData): ComparableCompany {
  const ebitdaMargin = data.revenue > 0 ? data.ebitda / data.revenue : 0;

  return {
    ticker: data.ticker,
    name: data.name,
    sector: data.sector || 'Unknown',
    industry: data.industry || 'Unknown',
    marketCap: data.marketCap,
    enterpriseValue: data.enterpriseValue,
    evRevenue: data.evRevenue,
    evEbitda: data.evEbitda,
    revenue: data.revenue,
    ebitda: data.ebitda,
    revenueGrowth: 0,
    ebitdaMargin: ebitdaMargin,
    price: data.price,
    beta: data.beta,
    sharesOutstanding: data.sharesOutstanding,
    peRatio: data.peRatio ?? undefined,
    currency: data.currency,
    isSelected: true,
  };
}

/**
 * Clear all caches
 */
export function clearCaches() {
  marketDataCache.clear();
  historicalCache.clear();
  console.warn('[Yahoo Finance] All caches cleared');
}

/**
 * Calculate beta against S&P 500
 * Uses the standard regression method: beta = Cov(Stock, Market) / Var(Market)
 * @param ticker - Stock ticker symbol
 * @param years - Number of years of data to use (default 2)
 */
export async function calculateBeta(
  ticker: string,
  years: number = 2
): Promise<number | null> {
  const MARKET_PROXY = 'SPY';
  try {
    // Fetch stock and market data in parallel
    // OPTIMIZATION: Cache SPY history globally so we don't fetch it every time
    const now = Date.now();
    const fetchSpy = !spyHistoryCache || (now - spyHistoryLastFetch > SPY_CACHE_DURATION);

    const [stockData, marketData] = await Promise.all([
      getHistoricalPrices(ticker, `${years}y`),
      fetchSpy ? getHistoricalPrices(MARKET_PROXY, `${years}y`) : Promise.resolve(spyHistoryCache!)
    ]);

    if (fetchSpy && marketData && marketData.length > 0) {
      spyHistoryCache = marketData;
      spyHistoryLastFetch = now;
    }

    if (!stockData || stockData.length === 0 || !marketData || marketData.length === 0) {
      return null;
    }

    // Align dates and calculate returns
    const alignedData = alignPriceData(stockData, marketData);

    if (alignedData.length < 30) {
      return null;
    }

    // Calculate returns
    const stockReturns = calculateReturns(alignedData.map(d => d.stockPrice));
    const marketReturns = calculateReturns(alignedData.map(d => d.marketPrice));

    // Calculate beta
    const beta = calculateRegressionBeta(stockReturns, marketReturns);

    return Number(beta.toFixed(2));
  } catch (error) {
    console.error(`[Yahoo Finance] Error calculating beta for ${ticker}:`, error);
    return null;
  }
}

/**
 * Align price data from two sources by date
 */
function alignPriceData(
  stockData: HistoricalPrice[],
  marketData: HistoricalPrice[]
): { date: string; stockPrice: number; marketPrice: number }[] {
  const stockMap = new Map(stockData.map(p => [p.date, p.close]));
  const marketMap = new Map(marketData.map(p => [p.date, p.close]));

  // Find common dates
  const commonDates = Array.from(stockMap.keys()).filter(date => marketMap.has(date));

  return commonDates
    .map(date => ({
      date,
      stockPrice: stockMap.get(date)!,
      marketPrice: marketMap.get(date)!,
    }))
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
}

/**
 * Calculate daily returns from price array
 */
function calculateReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1] !== 0) {
      returns.push((prices[i] - prices[i - 1]) / prices[i - 1]);
    }
  }
  return returns;
}

/**
 * Calculate beta using regression
 * beta = Cov(Stock, Market) / Var(Market)
 */
function calculateRegressionBeta(stockReturns: number[], marketReturns: number[]): number {
  if (stockReturns.length !== marketReturns.length || stockReturns.length === 0) {
    return 1.0;
  }

  const n = stockReturns.length;

  // Calculate means
  const meanStock = stockReturns.reduce((a, b) => a + b, 0) / n;
  const meanMarket = marketReturns.reduce((a, b) => a + b, 0) / n;

  // Calculate covariance and variance
  let covariance = 0;
  let variance = 0;

  for (let i = 0; i < n; i++) {
    const stockDiff = stockReturns[i] - meanStock;
    const marketDiff = marketReturns[i] - meanMarket;

    covariance += stockDiff * marketDiff;
    variance += marketDiff * marketDiff;
  }

  covariance /= n;
  variance /= n;

  if (variance === 0) return 1.0;

  return covariance / variance;
}
