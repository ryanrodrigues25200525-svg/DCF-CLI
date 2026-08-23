import { useMemo } from 'react';
import type { Assumptions, DCFResults, HistoricalData, ModelDiagnostic } from '@/core/types';

export function useDiagnostics(
    assumptions: Assumptions | null,
    results: DCFResults | null,
    historicals: HistoricalData | null,
): ModelDiagnostic[] {
    return useMemo(() => {
        if (!assumptions || !results || !historicals) return [];
        const checks: ModelDiagnostic[] = [];

        if (results.isValuationSupported === false) {
            checks.push({
                status: 'fail',
                msg: results.modelWarning || 'Selected company requires a model that is not implemented yet.',
            });
            return checks;
        }

        if (assumptions.valuationMethod === 'growth') {
            if (assumptions.wacc > assumptions.terminalGrowthRate) {
                checks.push({ status: 'pass', msg: 'WACC > Terminal Growth' });
            } else {
                checks.push({ status: 'fail', msg: 'Terminal Growth exceeds WACC' });
            }
        }

        const positiveYears = results.forecasts.filter((f) => f.fcff > 0).length;
        if (positiveYears === results.forecasts.length) {
            checks.push({ status: 'pass', msg: 'FCFF positive across horizon' });
        } else if (positiveYears > 0) {
            checks.push({ status: 'warning', msg: `Negative FCFF in ${results.forecasts.length - positiveYears} years` });
        }

        const avgHistGrowth = historicals.revenue.length > 1
            ? historicals.revenue.reduce((acc, val, i, arr) => {
                if (i === 0) return 0;
                return acc + ((val - arr[i - 1]) / arr[i - 1]);
            }, 0) / (historicals.revenue.length - 1)
            : 0;

        if (assumptions.revenueGrowth > avgHistGrowth * 1.5) {
            checks.push({ status: 'warning', msg: 'Growth higher than historical trend' });
        } else if (avgHistGrowth > 0 && assumptions.revenueGrowth < avgHistGrowth * 0.5) {
            checks.push({ status: 'warning', msg: 'Growth significantly below historical trend' });
        } else {
            checks.push({ status: 'pass', msg: 'Growth aligned with history' });
        }

        return checks;
    }, [assumptions, results, historicals]);
}
