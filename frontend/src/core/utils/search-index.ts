import Fuse from 'fuse.js';

const TICKER_URL = "https://www.sec.gov/files/company_tickers.json";
const USER_AGENT =
    process.env.SEC_USER_AGENT ||
    process.env.EDGAR_IDENTITY ||
    "DCFBuilder_Research/1.0 (security@example.com)";

export interface TickerResult {
    ticker: string;
    title: string;
    cik_str: number;
}

interface SecTickerData {
    [key: string]: TickerResult;
}

// Global cache to persist across HMR in development
const globalForSearch = global as unknown as {
    _searchIndex: Fuse<TickerResult> | null;
    _tickerData: TickerResult[] | null;
    _lastFetch: number;
};

class SearchIndex {
    private fuse: Fuse<TickerResult> | null = globalForSearch._searchIndex || null;
    private data: TickerResult[] | null = globalForSearch._tickerData || null;
    private lastFetch: number = globalForSearch._lastFetch || 0;
    private fetchPromise: Promise<TickerResult[]> | null = null;
    private CACHE_TTL = 3600 * 1000; // 1 hour
    private degraded = false;

    constructor() {
        if (process.env.NODE_ENV !== 'production') {
            globalForSearch._searchIndex = this.fuse;
            globalForSearch._tickerData = this.data;
            globalForSearch._lastFetch = this.lastFetch;
        }
    }

    private async fetchData(): Promise<TickerResult[]> {
        const now = Date.now();
        if (this.data && this.fuse && (now - this.lastFetch < this.CACHE_TTL)) {
            return this.data;
        }
        if (this.fetchPromise) {
            return this.fetchPromise;
        }

        this.fetchPromise = this.fetchDataInternal();
        try {
            return await this.fetchPromise;
        } finally {
            this.fetchPromise = null;
        }
    }

    private async fetchDataInternal(): Promise<TickerResult[]> {
        try {
            console.warn("Fetching SEC tickers...");
            const res = await fetch(TICKER_URL, {
                headers: {
                    "User-Agent": USER_AGENT,
                    "Accept-Encoding": "gzip, deflate"
                },
                next: { revalidate: 3600 }
            });

            if (!res.ok) throw new Error(`Failed to fetch tickers: ${res.status}`);

            const json: SecTickerData = await res.json();
            const data = Object.values(json);

            this.data = data;

            // Re-initialize Fuse with new data
            this.fuse = new Fuse(data, {
                keys: [
                    { name: 'ticker', weight: 0.7 },
                    { name: 'title', weight: 0.3 }
                ],
                threshold: 0.4, // Lower = stricter, Higher = fuzzier. 0.4 is a good balance.
                distance: 100,
                ignoreLocation: true,
                minMatchCharLength: 2
            });

            this.lastFetch = Date.now();
            this.degraded = false;

            // Update global cache
            if (process.env.NODE_ENV !== 'production') {
                globalForSearch._tickerData = this.data;
                globalForSearch._searchIndex = this.fuse;
                globalForSearch._lastFetch = this.lastFetch;
            }

            console.warn(`Loaded ${data.length} tickers into search index.`);
            return data;
        } catch (error) {
            console.error("Error loading ticker data:", error);
            this.degraded = true;
            // Return existing data if available even if stale
            return this.data || [];
        }
    }

    private formatCik(cik: number): string {
        return cik.toString().padStart(10, '0');
    }

    private stripLeadingZeros(value: string): string {
        const stripped = value.replace(/^0+/, '');
        return stripped.length > 0 ? stripped : '0';
    }

    public async search(query: string, limit: number = 10): Promise<TickerResult[]> {
        if (!this.fuse || !this.data) {
            const loaded = await this.fetchData();
            if (loaded.length === 0 || !this.fuse) return [];
        }

        const raw = query.trim();
        if (!raw) return [];
        const q = raw.toUpperCase();
        const qDigits = raw.replace(/\D/g, '');
        const qDigitsNoLead = qDigits ? this.stripLeadingZeros(qDigits) : '';
        const max = Math.max(1, Math.min(20, limit));

        // Single-pass bucket sort: O(n) instead of 7×O(n) filters
        const buckets: { tickerExact: TickerResult[]; cikExact: TickerResult[]; tickerPrefix: TickerResult[]; cikPrefix: TickerResult[]; namePrefix: TickerResult[]; nameContains: TickerResult[] } = {
            tickerExact: [],
            cikExact: [],
            tickerPrefix: [],
            cikPrefix: [],
            namePrefix: [],
            nameContains: [],
        };

        const hasDigits = Boolean(qDigits);
        for (const item of this.data!) {
            const tu = item.ticker.toUpperCase();
            const titleUp = item.title.toUpperCase();
            const cik = this.formatCik(item.cik_str);
            const cikNoLead = this.stripLeadingZeros(cik);

            if (tu === q) {
                buckets.tickerExact.push(item);
                continue;
            }
            if (hasDigits && (cik === qDigits || cikNoLead === qDigitsNoLead)) {
                buckets.cikExact.push(item);
                continue;
            }
            if (tu.startsWith(q)) {
                buckets.tickerPrefix.push(item);
                continue;
            }
            if (hasDigits && (cik.startsWith(qDigits) || cikNoLead.startsWith(qDigitsNoLead))) {
                buckets.cikPrefix.push(item);
                continue;
            }
            if (titleUp.startsWith(q)) {
                buckets.namePrefix.push(item);
                continue;
            }
            if (titleUp.includes(q)) {
                buckets.nameContains.push(item);
            }
        }

        // Cap total candidates before fuse to keep it fast; if we already have enough exact/prefix hits, skip fuzzy
        const preFuseCount = buckets.tickerExact.length + buckets.cikExact.length + buckets.tickerPrefix.length + buckets.cikPrefix.length + buckets.namePrefix.length;
        const fuzzy: TickerResult[] = preFuseCount >= max ? [] : this.fuse.search(q, { limit: max * 3 }).map((r) => r.item);

        const merged = [
            ...buckets.tickerExact,
            ...buckets.cikExact,
            ...buckets.tickerPrefix,
            ...buckets.cikPrefix,
            ...buckets.namePrefix,
            ...buckets.nameContains,
            ...fuzzy,
        ];
        const seen = new Set<string>();
        const deduped: TickerResult[] = [];
        for (const item of merged) {
            const key = item.ticker.toUpperCase();
            if (seen.has(key)) continue;
            seen.add(key);
            deduped.push(item);
            if (deduped.length >= max) break;
        }

        return deduped;
    }

    public getStatus(): { degraded: boolean; hasData: boolean; lastFetch: number } {
        return {
            degraded: this.degraded,
            hasData: Array.isArray(this.data) && this.data.length > 0,
            lastFetch: this.lastFetch,
        };
    }
}

export const searchIndex = new SearchIndex();
