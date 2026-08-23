import { useMemo } from 'react';
import { calculateRoutedValuation } from '@/services/valuation/router';
import { useCompanyWorkspace } from '@/hooks/dcf/useCompanyWorkspace';
import { useValuationAssumptions } from '@/hooks/dcf/useValuationAssumptions';
import { useScenarioControls } from '@/hooks/dcf/useScenarioControls';
import { useDiagnostics } from '@/hooks/dcf/useDiagnostics';

export function useDCFModel() {
    const workspace = useCompanyWorkspace();
    const valuation = useValuationAssumptions(workspace.companyData, workspace.currentTicker, workspace.marketData);
    const scenarioControls = useScenarioControls({
        historicals: valuation.historicals,
        company: valuation.company,
        assumptions: valuation.assumptions,
        marketData: workspace.marketData,
        setAssumptions: valuation.setAssumptions,
        setOverrides: valuation.setOverrides,
    });

    const results = useMemo(() => {
        if (!valuation.historicals || !valuation.assumptions) return null;
        return calculateRoutedValuation(valuation.historicals, valuation.assumptions, valuation.overrides, valuation.company, valuation.modelEligibility);
    }, [valuation.historicals, valuation.assumptions, valuation.overrides, valuation.company, valuation.modelEligibility]);

    const diagnostics = useDiagnostics(valuation.assumptions, results, valuation.historicals);

    const clearCompany = () => {
        workspace.clearCompany();
        valuation.resetWorkspace();
        scenarioControls.resetScenarioState();
    };

    return {
        state: {
            loading: workspace.loading,
            isRefreshingCompany: workspace.isRefreshingCompany,
            companyLoadTiming: workspace.companyLoadTiming,
            error: workspace.error,
            company: valuation.company,
            historicals: valuation.historicals,
            financialsNative: valuation.financialsNative,
            modelEligibility: valuation.modelEligibility,
            valuationContext: workspace.companyData?.valuationContext ?? null,
            dataQuality: workspace.companyData?.dataQuality ?? null,
            completeness: workspace.companyData?.completeness ?? null,
            degradedReason: workspace.companyData?.degradedReason ?? null,
            assumptions: valuation.assumptions,
            results,
            overrides: valuation.overrides,
            activeScenario: scenarioControls.activeScenario,
            diagnostics,
            revenueBuildData: valuation.revenueBuildData,
            comparableCompanies: valuation.comparableCompanies,
            precedentTransactions: valuation.precedentTransactions,
        },
        actions: {
            loadCompany: workspace.loadCompany,
            clearCompany,
            updateAssumption: valuation.updateAssumption,
            updateAssumptions: valuation.updateAssumptions,
            applyScenario: scenarioControls.applyScenario,
            resetToDefaults: scenarioControls.resetToDefaults,
            setRevenueBuildData: valuation.setRevenueBuildData,
            setComparableCompanies: valuation.setComparableCompanies,
            setPrecedentTransactions: valuation.setPrecedentTransactions,
        },
    };
}
