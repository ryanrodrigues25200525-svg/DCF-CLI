export interface RevenueDriver {
    id: string;
    name: string;
    type: 'bottom_up' | 'top_down';
    baseUnits?: number;
    unitGrowthRate?: number;
    pricePerUnit?: number;
    priceGrowthRate?: number;
    totalAddressableMarket?: number;
    tamGrowthRate?: number;
    currentMarketShare?: number;
    targetMarketShare?: number;
    marketShareConvergenceYears?: number;
}

export interface RevenueBuild {
    approach: 'bottom_up' | 'top_down' | 'hybrid';
    drivers: RevenueDriver[];
    projectedRevenue: number[];
    projectedGrowth: number[];
}
