import type { Assumptions, CompanyProfile, DCFResults, HistoricalData } from '@/core/types';
import type { HistoricalFinancials, MarketData, ModelAssumptions, ScenarioConfig, UiMeta, WaccLoopMode } from './types';

export function buildMarketSnapshot(historicals: HistoricalData, assumptions: Assumptions, currentMarketCap?: number | null): MarketData {
    const lastIdx = Math.max(0, historicals.years.length - 1);
    const latestCash = requireHistoricalValue(historicals.cash, lastIdx, 'cash');
    const latestDebt = requireHistoricalValue(historicals.totalDebt, lastIdx, 'debt');
    const securitiesLine = historicals.sourceData?.marketable_securities?.[lastIdx];
    const explicitlyNotApplicableSecurities = securitiesLine?.source === 'not_applicable'
        && securitiesLine.sources.length > 0
        && securitiesLine.sources.every((source) => source.accession && source.filed);
    const latestMarketableSecurities = explicitlyNotApplicableSecurities
        ? 0
        : requireHistoricalValue(historicals.marketableSecurities, lastIdx, 'marketable securities');
    const preferredEquityLine = historicals.sourceData?.preferred_equity?.[lastIdx];
    const preferredEquity = preferredEquityLine?.source === 'not_applicable'
        ? 0
        : preferredEquityLine?.value;
    if (preferredEquity === null || preferredEquity === undefined) {
        throw new Error('Preferred equity must be sourced or explicitly marked not applicable for the common-equity bridge.');
    }
    const price = historicals.price;
    if (price === null || price <= 0) throw new Error('A dated positive market price is required for the equity bridge.');
    const sharesDiluted = (assumptions.dilutedSharesOutstanding && assumptions.dilutedSharesOutstanding > 0)
        ? assumptions.dilutedSharesOutstanding
        : historicals.sharesOutstanding;
    if (sharesDiluted === null || sharesDiluted <= 0) throw new Error('A sourced diluted share count is required for the equity bridge.');
    const minorityInterest = requireHistoricalValue(historicals.nonControllingInterest, lastIdx, 'noncontrolling interest');

    return {
        currentPrice: price,
        sharesDiluted,
        marketCap: currentMarketCap && currentMarketCap > 0 ? currentMarketCap : price * sharesDiluted,
        cash: latestCash,
        debt: latestDebt,
        netDebt: latestDebt - latestCash,
        minorityInterest,
        preferredEquity,
        nonOperatingAssets: latestMarketableSecurities,
    };
}

function requireHistoricalValue(values: HistoricalData['cash'] | undefined, index: number, field: string): number {
    const value = values?.[index];
    if (value === null || value === undefined || !Number.isFinite(value)) {
        throw new Error(`A sourced ${field} balance is required for the equity bridge.`);
    }
    return value;
}

function ratio(numerator: number | null, denominator: number | null): number | null {
    if (numerator === null || denominator === null || denominator <= 0) return null;
    return numerator / denominator;
}

function difference(left: number | null, right: number | null): number | null {
    return left === null || right === null ? null : left - right;
}

function absolute(value: number | null): number | null {
    return value === null ? null : Math.abs(value);
}

function canonicalReview(historicals: HistoricalData): {warnings: string[]; sourceNotes: string[]} {
    const warnings: string[] = [];
    const sourceNotes: string[] = [];
    const sourceData = historicals.sourceData ?? {};

    for (const [field, lines] of Object.entries(sourceData)) {
        lines.forEach((line, index) => {
            const fiscalPeriod = `FY ${historicals.years[index]}`;
            if (line.source === 'missing' || line.source === 'ambiguous') {
                warnings.push(`${fiscalPeriod} ${field}: ${line.source} SEC mapping; ${line.method}.`);
                for (const candidate of line.candidates ?? []) {
                    warnings.push(`${fiscalPeriod} ${field}: candidate ${candidate.concept ?? 'unknown concept'}=${candidate.value ?? 'unavailable'}.`);
                }
                return;
            }
            if (line.source === 'not_applicable') {
                sourceNotes.push(`${fiscalPeriod} ${field}: not applicable; ${line.method}.`);
                return;
            }
            if (line.sources.length === 0) {
                warnings.push(`${fiscalPeriod} ${field}: source metadata unavailable for ${line.source} value; ${line.method}.`);
                return;
            }
            for (const source of line.sources) {
                sourceNotes.push([
                    `${fiscalPeriod} ${field}: ${line.source} value ${line.value ?? 'unavailable'}`,
                    `concept ${source.concept ?? 'unavailable'}`,
                    `form ${source.form ?? 'unavailable'}`,
                    `accession ${source.accession ?? 'unavailable'}`,
                    `filed ${source.filed ?? 'unavailable'}`,
                    `period end ${source.period_end ?? 'unavailable'}`,
                    `currency ${source.currency ?? 'unavailable'}`,
                    `unit ${source.unit ?? 'unavailable'}`,
                    `scale ${source.unit_scale ?? 'unavailable'}`,
                    `method ${line.method}`,
                ].join('; '));
            }
        });
    }

    return {warnings, sourceNotes};
}

export function buildHistoricalFinancials(historicals: HistoricalData): HistoricalFinancials {
    const preTaxIncome = historicals.ebit.map((ebit, i) => difference(ebit, historicals.interestExpense[i]));
    const revenueGrowth = historicals.revenue.map((rev, i) => {
        if (i === 0) return null;
        const previous = historicals.revenue[i - 1];
        return rev === null || previous === null || previous <= 0 ? null : (rev / previous) - 1;
    });
    const grossMargin = historicals.revenue.map((rev, i) => ratio(historicals.grossProfit[i], rev));
    const ebitdaMargin = historicals.revenue.map((rev, i) => ratio(historicals.ebitda[i], rev));
    const ebitMargin = historicals.revenue.map((rev, i) => ratio(historicals.ebit[i], rev));
    const effectiveTaxRate = preTaxIncome.map((pti, i) => {
        const tax = historicals.incomeTaxExpense[i];
        if (pti !== null && tax !== null && Math.abs(pti) > 0) return Math.abs(tax) / Math.abs(pti);
        return historicals.taxRate[i];
    });
    const netMargin = historicals.revenue.map((rev, i) => ratio(historicals.netIncome[i], rev));
    const taxExpenseAbs = historicals.incomeTaxExpense.map(absolute);
    const operatingExpenses = historicals.grossProfit.map((grossProfit, i) => difference(grossProfit, historicals.ebit[i]));

    return {
        years: historicals.years,
        income: {
            'Total Revenue': historicals.revenue,
            'Revenue Growth': revenueGrowth,
            'Cost of Revenue': historicals.costOfRevenue,
            'Gross Profit': historicals.grossProfit,
            'Gross Margin': grossMargin,
            'Research & Development': historicals.researchAndDevelopment || [],
            'SG&A': historicals.generalAndAdministrative || [],
            'D&A (included in Operating)': historicals.depreciation,
            'EBITDA': historicals.ebitda,
            'EBITDA Margin': ebitdaMargin,
            'Operating Income (EBIT)': historicals.ebit,
            'EBIT Margin': ebitMargin,
            'Interest Expense': historicals.interestExpense,
            'Pre-Tax Income': preTaxIncome,
            'Income Taxes': taxExpenseAbs,
            'Effective Tax Rate': effectiveTaxRate,
            'Net Income': historicals.netIncome,
            'Net Margin': netMargin,
            Revenue: historicals.revenue,
            COGS: historicals.costOfRevenue,
            GrossProfit: historicals.grossProfit,
            EBIT: historicals.ebit,
            'Income Tax Expense': taxExpenseAbs,
            Tax: taxExpenseAbs,
            'Tax Rate': historicals.taxRate,
            'R&D': historicals.researchAndDevelopment || [],
            DA: historicals.depreciation,
            NetIncome: historicals.netIncome,
            'Operating Expenses': operatingExpenses,
            'Other Operating Expenses': historicals.otherOperatingExpenses || [],
            'Sales Commission': historicals.marketing || [],
            'G&A': historicals.generalAndAdministrative || [],
            Rent: historicals.rent || [],
            'Bad Debt': historicals.badDebt || [],
            Purchases: historicals.purchases || historicals.costOfRevenue,
        },
        balance: {
            Cash: historicals.cash,
            TotalDebt: historicals.totalDebt,
            OperatingNetWorkingCapital: historicals.operatingNetWorkingCapital || [],
            OperatingLeaseLiabilities: historicals.operatingLeaseLiabilities || [],
            TotalAssets: historicals.totalAssets,
            ShareholdersEquity: historicals.shareholdersEquity,
            NoncontrollingInterest: historicals.nonControllingInterest || [],
            AccountsReceivable: historicals.accountsReceivable || [],
            Inventory: historicals.inventory || [],
            AccountsPayable: historicals.accountsPayable || [],
            PPENet: historicals.ppeNet || [],
            NetPPE: historicals.ppeNet || [],
            OtherAssets: historicals.otherAssets || [],
            OtherLiabilities: historicals.otherLiabilities || [],
        },
        cashflow: {
            Depreciation: historicals.depreciation,
            Capex: historicals.capex,
            'Dividends Paid': historicals.dividendsPaid || [],
            StockBasedComp: historicals.stockBasedComp || [],
            DeferredTax: historicals.deferredTax || [],
            OtherNonCash: historicals.otherNonCash || [],
        },
    };
}

export function buildExportAssumptions(assumptions: Assumptions, historicals: HistoricalData): ModelAssumptions {
    const assumptionExtensions = assumptions as Assumptions & {
        waccLoopMode?: WaccLoopMode;
        scenarioConfig?: ScenarioConfig;
    };
    const waccLoopMode = assumptionExtensions.waccLoopMode;
    const scenarioConfig = assumptionExtensions.scenarioConfig;
    return {
        scenarioMode: 'Base',
        horizonYears: assumptions.forecastYears,
        revenueMethod: 'TopDown',
        daPctRevenue: assumptions.deaRatio,
        deaRatio: assumptions.deaRatio,
        capexPctRevenue: assumptions.capexRatio,
        capexRatio: assumptions.capexRatio,
        grossMargin: assumptions.grossMargin,
        ebitMargin: assumptions.ebitMargin,
        ebitMarginTarget: assumptions.ebitMargin,
        ebitdaMargin: assumptions.ebitMargin + assumptions.deaRatio,
        rdMargin: assumptions.rdMargin,
        sgaMargin: assumptions.sgaMargin,
        dso: assumptions.accountsReceivableDays,
        dio: assumptions.inventoryDays,
        dpo: assumptions.accountsPayableDays,
        accountsReceivableDays: assumptions.accountsReceivableDays,
        inventoryDays: assumptions.inventoryDays,
        accountsPayableDays: assumptions.accountsPayableDays,
        revenueGrowth: assumptions.revenueGrowth,
        marginRampYears: assumptions.ebitMarginConvergenceYears || 5,
        taxRate: assumptions.taxRate,
        dividendPayoutRatio: assumptions.dividendPayoutRatio,
        capexMethod: '%Revenue',
        daMethod: '%Revenue',
        wcMethod: 'NWC_%Revenue',
        nwcPctRevenue: assumptions.nwcChangeRatio,
        wacc: {
            rf: assumptions.riskFreeRate ?? 0.046,
            erp: assumptions.equityRiskPremium ?? 0.052,
            beta: assumptions.beta ?? historicals.beta ?? 1.0,
            sizePremium: 0,
            costOfDebt: assumptions.costOfDebt ?? 0.058,
            debtWeight: assumptions.weightDebt ?? 0.15,
            equityWeight: assumptions.weightEquity ?? 0.85,
        },
        waccRate: assumptions.wacc,
        ...(waccLoopMode ? {waccLoopMode} : {}),
        ...(scenarioConfig ? {scenarioConfig} : {}),
        terminal: {
            method: assumptions.valuationMethod === 'growth' ? 'Perpetuity' : 'ExitMultiple',
            g: assumptions.terminalGrowthRate,
            exitMultiple: assumptions.terminalExitMultiple,
            exitMetric: 'EBITDA',
        },
        advancedMode: assumptions.advancedMode,
        revenueGrowthStage1: assumptions.revenueGrowthStage1,
        revenueGrowthStage2: assumptions.revenueGrowthStage2,
        revenueGrowthStage3: assumptions.revenueGrowthStage3,
        revenueGrowthStage1Years: assumptions.revenueGrowthStage1Years ?? 3,
        revenueGrowthFadeYears: assumptions.revenueGrowthFadeYears ?? 4,
        ebitMarginSteadyState: assumptions.ebitMarginSteadyState,
        ebitMarginConvergenceYears: assumptions.ebitMarginConvergenceYears,
        leverageTarget: assumptions.leverageTarget,
    };
}

export function buildUiMeta(company: CompanyProfile, historicals: HistoricalData, assumptions: Assumptions, results: DCFResults): UiMeta {
    const lastIndex = Math.max(0, historicals.years.length - 1);
    const latestNonControllingInterest = historicals.nonControllingInterest?.[lastIndex] ?? null;
    const latestLeaseLiabilities = historicals.operatingLeaseLiabilities?.[lastIndex] ?? null;
    const canonicalReviewItems = canonicalReview(historicals);
    return {
        printDate: new Date().toLocaleDateString(),
        companyName: company.name,
        currency: historicals.currency || 'USD',
        confidenceLabel: results.confidenceRank,
        confidenceScore: results.confidenceScore,
        warnings: [
            ...(historicals.normalizationWarnings || []),
            ...canonicalReviewItems.warnings,
            ...(results.terminalGrowthWarning ? [results.terminalGrowthWarning] : []),
            ...(results.bsImbalanceWarning ? [results.bsImbalanceWarning] : []),
            ...(results.negativeCashFlowWarning ? [results.negativeCashFlowWarning] : []),
            ...(results.sectorWarning ? [results.sectorWarning] : []),
            ...(results.tvDivergenceFlag ? ['Terminal value methods show significant divergence'] : []),
        ],
        sourceNotes: [
            'WACC calculated using CAPM methodology',
            'Terminal value: ' + (assumptions.valuationMethod === 'growth' ? 'Gordon Growth Model' : 'Exit Multiple Method'),
            `Data as of ${new Date().toLocaleDateString()}`,
            ...canonicalReviewItems.sourceNotes,
            ...(latestLeaseLiabilities !== null
                ? [`FY${historicals.years[lastIndex]} operating lease liabilities are ${latestLeaseLiabilities}; lease expense remains in EBIT/FCFF, so leases are not deducted again in the enterprise-to-common-equity bridge.`]
                : []),
            ...(latestNonControllingInterest !== null && latestNonControllingInterest > 0
                ? [`FY${historicals.years[lastIndex]} noncontrolling interest is sourced from the SEC balance sheet and deducted separately from enterprise value.`]
                : []),
        ],
        keyMetrics: {
            avgROIC: results.avgROIC,
            valueCreationFlag: results.valueCreationFlag,
            tvDivergenceFlag: results.tvDivergenceFlag,
            terminalValue: results.terminalValue,
            pvTerminalValue: results.pvTerminalValue,
            enterpriseValue: results.enterpriseValue ?? undefined,
            equityValue: results.equityValue,
            impliedSharePrice: results.impliedSharePrice,
            impliedUpside: results.upside,
            terminalValueGordon: results.terminalValueGordon,
            terminalValueExitMultiple: results.terminalValueExitMultiple,
        },
    };
}
