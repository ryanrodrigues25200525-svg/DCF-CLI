
import { Assumptions } from '@/core/types';

export interface WorkingCapitalResult {
    accountsReceivable: number;
    inventory: number;
    accountsPayable: number;
    nwc: number;
    nwcChange: number;
}

/**
 * Projects working capital components based on revenue and COGS.
 */
export function projectWorkingCapital(
    revenue: number,
    costOfRevenue: number,
    assumptions: Assumptions,
    previousNwc: number
): WorkingCapitalResult {
    const safeDays = (days: number) => Math.max(0, days);

    const accountsReceivable = (revenue / 365) * safeDays(assumptions.accountsReceivableDays);
    const inventory = (costOfRevenue / 365) * safeDays(assumptions.inventoryDays);
    const accountsPayable = (costOfRevenue / 365) * safeDays(assumptions.accountsPayableDays);

    // Let the explicit NWC intensity assumption act as an overlay on top of the
    // day-based schedule so both controls participate in the live model.
    const intensityOverlay = revenue * (assumptions.nwcChangeRatio ?? 0);
    const nwc = (accountsReceivable + inventory) - accountsPayable + intensityOverlay;
    const nwcChange = nwc - previousNwc;

    return {
        accountsReceivable,
        inventory,
        accountsPayable,
        nwc,
        nwcChange
    };
}
