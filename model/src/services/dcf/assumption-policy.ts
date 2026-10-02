import { applyIndustryTemplateAssumptions, detectIndustryTemplate } from '@/core/data/industry-templates';
import { calculateInitialAssumptions } from '@/services/dcf/engine';
import type { Assumptions, CompanyProfile, HistoricalData } from '@/core/types';
import { calculateWACC } from '@/services/calculators/wacc';

interface MarketAssumptionInputs {
    rf?: number;
    mrp?: number;
}

const CAPITAL_DRIVER_KEYS: Array<keyof Assumptions> = [
    'riskFreeRate',
    'equityRiskPremium',
    'beta',
    'costOfDebt',
    'leverageTarget',
    'taxRate',
    'currentDebt',
    'annualDebtRepayment',
    'modelType',
];

function getLastNumber(values: ReadonlyArray<number | null> | undefined, fallback = 0): number {
    if (!Array.isArray(values) || values.length === 0) return fallback;
    const value = values[values.length - 1];
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function deriveCapitalInputs(input: Assumptions, historicals: HistoricalData, marketCapOverride?: number) {
    const modelType = input.modelType || 'unlevered';
    const shares = input.dilutedSharesOutstanding ?? historicals.sharesOutstanding ?? 0;
    const price = historicals.price ?? 0;
    const equityValue = marketCapOverride !== undefined && marketCapOverride > 0
        ? marketCapOverride
        : shares > 0 && price > 0 ? shares * price : 0;

    const historicalDebt = getLastNumber(historicals.totalDebt, 0);
    const leverageTarget = Math.max(0, Math.min(0.95, input.leverageTarget ?? 0));
    const hasExplicitLeverageTarget = input.leverageTarget !== undefined && Number.isFinite(input.leverageTarget);
    let totalDebt = modelType === 'levered' && (input.currentDebt ?? 0) > 0
        ? (input.currentDebt ?? 0)
        : hasExplicitLeverageTarget && equityValue > 0
        ? (leverageTarget / Math.max(1 - leverageTarget, 0.05)) * equityValue
        : (input.currentDebt ?? historicalDebt);
    if (!(totalDebt > 0) && leverageTarget > 0 && equityValue > 0) {
        totalDebt = (leverageTarget / Math.max(1 - leverageTarget, 0.05)) * equityValue;
    }

    const ebit = getLastNumber(historicals.ebit, 0);
    const historicalInterest = Math.abs(getLastNumber(historicals.interestExpense, 0));
    const fallbackCostOfDebt = input.costOfDebt ?? 0.05;
    const impliedInterestExpense = totalDebt > 0 ? totalDebt * fallbackCostOfDebt : 0;
    const interestExpense = historicalInterest > 0 ? historicalInterest : impliedInterestExpense;
    const icr = interestExpense > 0 ? ebit / interestExpense : undefined;

    return {
        equityValue,
        totalDebt: Math.max(0, totalDebt),
        icr,
    };
}

function reconcileDiscountRates(input: Assumptions, historicals?: HistoricalData | null, marketCapOverride?: number): Assumptions {
    if (!historicals) return input;

    const modelType = input.modelType || 'unlevered';
    const next = { ...input };
    const riskFreeRate = next.riskFreeRate ?? 0.04;
    const equityRiskPremium = next.equityRiskPremium ?? 0.05;
    const beta = next.beta ?? historicals.beta ?? 1.0;

    next.riskFreeRate = riskFreeRate;
    next.equityRiskPremium = equityRiskPremium;
    next.beta = beta;

    const { equityValue, totalDebt, icr } = deriveCapitalInputs(next, historicals, marketCapOverride);
    const waccResult = calculateWACC({
        riskFreeRate,
        equityRiskPremium,
        beta,
        costOfDebt: next.costOfDebt,
        icr,
        equityValue,
        totalDebt,
        taxRate: next.taxRate ?? 0.21,
    });

    next.currentDebt = totalDebt;
    next.unleveredBeta = waccResult.unleveredBeta;
    next.costOfDebt = waccResult.costOfDebt;
    next.costOfEquity = waccResult.costOfEquity;
    next.weightDebt = waccResult.debtWeight;
    next.weightEquity = waccResult.equityWeight;
    next.leverageTarget = waccResult.debtWeight;

    const shouldUseDerivedWacc = modelType !== 'unlevered' || next.discountRateMode !== 'manual';
    if (shouldUseDerivedWacc) {
        next.wacc = waccResult.wacc;
        next.discountRateMode = 'derived';
    } else {
        next.discountRateMode = 'manual';
    }

    return next;
}

export function normalizeAssumptions(
    input: Assumptions,
    sharesOutstanding: number,
    historicals?: HistoricalData | null,
    marketCapOverride?: number,
): Assumptions {
    const next = { ...input };
    next.forecastYears = Math.max(5, Math.min(15, Math.round(next.forecastYears || 5)));
    next.wacc = Math.max(0.01, Math.min(0.30, next.wacc));
    next.terminalGrowthRate = Math.max(0, Math.min(0.08, next.terminalGrowthRate));
    next.terminalExitMultiple = Math.max(2, Math.min(30, next.terminalExitMultiple));
    next.leverageTarget = Math.max(0, Math.min(0.7, next.leverageTarget ?? 0.2));
    next.taxRate = Math.max(0, Math.min(0.5, next.taxRate));
    if (!Number.isFinite(next.capexRatio) || next.capexRatio < 0 || next.capexRatio > 1) {
        throw new Error('CapEx as a percentage of revenue must be between 0% and 100%.');
    }
    if (!Number.isFinite(next.deaRatio) || next.deaRatio < 0 || next.deaRatio > 1) {
        throw new Error('D&A as a percentage of revenue must be between 0% and 100%.');
    }

    const modelType = next.modelType || 'unlevered';
    next.discountRateMode = next.discountRateMode === 'manual' ? 'manual' : 'derived';
    next.riskFreeRate = Math.max(0, Math.min(0.15, next.riskFreeRate ?? 0.04));
    next.beta = Math.max(0.2, Math.min(3.0, next.beta ?? 1.0));
    next.equityRiskPremium = Math.max(0.02, Math.min(0.15, next.equityRiskPremium ?? 0.05));
    next.costOfDebt = next.currentDebt === 0
        ? 0
        : Math.max(0.01, Math.min(0.20, next.costOfDebt ?? 0.05));

    if (modelType === 'levered') {
        next.currentDebt = Math.max(0, next.currentDebt ?? 0);
        next.annualDebtRepayment = Math.max(0, next.annualDebtRepayment ?? 0);
    }

    if (modelType === 'ddm') {
        next.currentDividendPerShare = Math.max(0, next.currentDividendPerShare ?? 0);
        next.dividendPayoutRatio = Math.max(0, Math.min(1, next.dividendPayoutRatio ?? 0.3));
        next.dividendGrowthRateStage1 = Math.max(-0.2, Math.min(0.3, next.dividendGrowthRateStage1 ?? 0.05));
        next.dividendGrowthRateStage2 = Math.max(-0.1, Math.min(0.2, next.dividendGrowthRateStage2 ?? 0.03));
        next.stage1Duration = Math.max(1, Math.min(20, next.stage1Duration ?? 5));
        next.stage2Duration = Math.max(1, Math.min(20, next.stage2Duration ?? 5));
        next.dilutedSharesOutstanding = Math.max(1, next.dilutedSharesOutstanding ?? sharesOutstanding ?? 1);
    }

    return reconcileDiscountRates(next, historicals, marketCapOverride);
}

function applyDetectedTemplate(base: Assumptions, profile?: Pick<CompanyProfile, 'ticker' | 'sector' | 'industry'> | null): Assumptions {
  const templateKey = detectIndustryTemplate(profile?.ticker, profile?.sector, profile?.industry);
  return templateKey ? applyIndustryTemplateAssumptions(base, templateKey) : base;
}

export function buildBaseAssumptions(
    historicals: HistoricalData,
    marketData: MarketAssumptionInputs,
    peerMedian: number,
    profile?: Pick<CompanyProfile, 'ticker' | 'sector' | 'industry'> | null,
    options: {useIndustryTemplate?: boolean} = {},
): Assumptions {
    const initial = calculateInitialAssumptions(
        historicals,
        { riskFreeRate: marketData.rf ?? 0.046, equityRiskPremium: marketData.mrp ?? 0.052 },
        { medianEvEbitda: peerMedian },
    );
    const templated = options.useIndustryTemplate === false ? initial : applyDetectedTemplate(initial, profile);
    return normalizeAssumptions(templated, historicals.sharesOutstanding || 0, historicals);
}

export function applyScenarioAssumptions(
    type: 'base' | 'conservative' | 'aggressive',
    base: Assumptions,
    currentModelType: Assumptions['modelType'],
    currentForecastYears: number,
    sharesOutstanding: number,
    historicals?: HistoricalData | null,
): Assumptions {
    const scenario = type === 'base'
        ? base
        : type === 'conservative'
            ? {
                ...base,
                revenueGrowth: base.revenueGrowth * (base.revenueGrowth > 0.15 ? 0.6 : base.revenueGrowth > 0.05 ? 0.75 : 0.85),
                revenueGrowthStage1: base.revenueGrowth * (base.revenueGrowth > 0.15 ? 0.6 : base.revenueGrowth > 0.05 ? 0.75 : 0.85),
                ebitMargin: base.ebitMargin * (base.ebitMargin < 0.10 ? 0.7 : 0.85),
                wacc: base.wacc + 0.01,
                beta: (base.beta || 1.2) + 0.1,
                costOfDebt: (base.costOfDebt || 0.05) + 0.01,
                dividendGrowthRateStage1: (base.dividendGrowthRateStage1 || 0.05) * 0.7,
                dividendGrowthRateStage2: (base.dividendGrowthRateStage2 || 0.03) * 0.8,
            }
            : {
                ...base,
                revenueGrowth: Math.min(base.revenueGrowth * (base.revenueGrowth > 0.15 ? 1.15 : base.revenueGrowth > 0.05 ? 1.25 : 1.4), 0.5),
                revenueGrowthStage1: Math.min(base.revenueGrowth * (base.revenueGrowth > 0.15 ? 1.15 : base.revenueGrowth > 0.05 ? 1.25 : 1.4), 0.5),
                ebitMargin: Math.min(base.ebitMargin * (base.ebitMargin > 0.20 ? 1.1 : 1.2), 0.4),
                wacc: Math.max(0.07, base.wacc - 0.01),
                beta: Math.max(0.5, (base.beta || 1.2) - 0.1),
                costOfDebt: Math.max(0.02, (base.costOfDebt || 0.05) - 0.005),
                dividendGrowthRateStage1: Math.min((base.dividendGrowthRateStage1 || 0.05) * 1.3, 0.2),
                dividendGrowthRateStage2: Math.min((base.dividendGrowthRateStage2 || 0.03) * 1.2, 0.1),
            };

    return normalizeAssumptions(
        {
            ...scenario,
            modelType: currentModelType || 'unlevered',
            forecastYears: currentForecastYears,
            discountRateMode: 'derived',
        },
        sharesOutstanding,
        historicals,
    );
}

export function shouldSwitchToDerivedDiscountRate(key: keyof Assumptions): boolean {
    return CAPITAL_DRIVER_KEYS.includes(key);
}
