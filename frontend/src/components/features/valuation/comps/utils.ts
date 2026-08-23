import { ComparableCompany } from '@/core/types';
import { GICS_SECTOR_BY_TICKER } from './constants';

export function normalizeComparablePeers(input: ComparableCompany[]): ComparableCompany[] {
    return input
        .map((peer) => {
            const record = peer as unknown as Record<string, unknown>;
            const ticker = String(record.ticker || record.symbol || '').trim().toUpperCase();
            if (!ticker) return null;
            return {
                ...peer,
                ticker,
                name: peer.name || ticker,
                isSelected: peer.isSelected ?? true,
            };
        })
        .filter((peer): peer is ComparableCompany => Boolean(peer));
}

export function median(values: number[]) {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function mean(values: number[]) {
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) / values.length : 0;
}

export function formatPrice(val: number | undefined) {
    return val ? `$${val.toFixed(2)}` : '-';
}

export function formatMoneyCompact(val: number | undefined) {
    if (!val || val <= 0) return '-';
    if (val >= 1e12) return `$${(val / 1e12).toFixed(1)}T`;
    if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
    if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
    return `$${val.toFixed(0)}`;
}

export function formatMult(val: number) {
    return val ? `${val.toFixed(1)}x` : '-';
}

export function formatPct(val: number) {
    const normalized = Math.abs(val) > 1.5 && Math.abs(val) <= 1000 ? val / 100 : val;
    return `${(normalized * 100).toFixed(1)}%`;
}

export function formatBeta(val: number | undefined) {
    if (val === undefined || !Number.isFinite(val) || val <= 0) return '-';
    return val.toFixed(2);
}

export const generateSparklineData = (ticker: string): number[] => {
    const safeTicker = String(ticker || '').trim().toUpperCase() || 'UNKNOWN';
    const seed = safeTicker.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
    const base = 100 + (seed % 50);
    const volatility = 0.02 + (seed % 10) / 100;
    let state = seed || 1;
    const nextRandom = () => {
        state = (state * 1664525 + 1013904223) >>> 0;
        return state / 0x100000000;
    };

    const data: number[] = [base];
    for (let i = 1; i < 52; i++) {
        const change = (nextRandom() - 0.5) * 2 * volatility;
        data.push(data[i - 1] * (1 + change));
    }
    return data;
};

const normalizeSector = (raw?: string) => {
    if (!raw) return '';
    const key = raw.trim().toLowerCase();
    if (key.includes('tech')) return 'Information Technology';
    if (key.includes('communication')) return 'Communication Services';
    if (key.includes('consumer discretionary') || key === 'consumer') return 'Consumer Discretionary';
    if (key.includes('consumer staples')) return 'Consumer Staples';
    if (key.includes('financial')) return 'Financials';
    if (key.includes('health')) return 'Health Care';
    if (key.includes('industrial')) return 'Industrials';
    if (key.includes('energy')) return 'Energy';
    if (key.includes('material')) return 'Materials';
    if (key.includes('utility')) return 'Utilities';
    if (key.includes('real estate')) return 'Real Estate';
    return raw;
};

export const getSectorLabel = (peer: ComparableCompany) => {
    const dynamicSector = normalizeSector(peer.sector);
    if (dynamicSector) return dynamicSector;
    return GICS_SECTOR_BY_TICKER[peer.ticker.toUpperCase()] || 'Unclassified';
};
