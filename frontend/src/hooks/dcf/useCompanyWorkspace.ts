import { useCallback, useState } from 'react';
import { useCompanyData } from '@/hooks/useCompanyData';

export function useCompanyWorkspace() {
    const [currentTicker, setCurrentTicker] = useState<string | null>(null);
    const companyQuery = useCompanyData(currentTicker);

    const hasUsableCompanyData = Boolean(companyQuery.data?.profile && companyQuery.data?.financials);
    const error = companyQuery.error && !hasUsableCompanyData ? (companyQuery.error as Error).message : null;
    const isRefreshingCompany = Boolean((companyQuery.isRefreshing || companyQuery.isFetching) && hasUsableCompanyData);

    const loadCompany = useCallback((ticker: string) => {
        const normalizedTicker = ticker.trim().toUpperCase();
        if (!normalizedTicker) return;
        setCurrentTicker((prev) => (prev === normalizedTicker ? prev : normalizedTicker));
    }, []);

    const clearCompany = useCallback(() => {
        setCurrentTicker(null);
    }, []);

    return {
        currentTicker,
        companyData: companyQuery.data || null,
        marketData: companyQuery.data?.marketData || null,
        loading: companyQuery.isLoading,
        error,
        isRefreshingCompany,
        companyLoadTiming: companyQuery.lastLoadTiming,
        loadCompany,
        clearCompany,
    };
}
