import type {AssetManagerHistoricalData} from '@/core/types';
import type {CanonicalFinancialLine, NativeUnifiedPayload} from '@/core/types/native';
import type {AssetManagerModelAssumptionSources, AssetManagerModelAssumptions, IncompleteAssetManagerModelAssumptions} from './asset-manager-model';

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (!line || !['sec_native', 'derived'].includes(line.source)) {
    throw new Error(`FY${year} asset-manager assumption input ${name} is missing or ambiguous.`);
  }
  if (typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} asset-manager assumption input ${name} has no finite filed value.`);
  }
  if (!line.sources.length || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${year} asset-manager assumption input ${name} has incomplete SEC provenance.`);
  }
  return line.value;
}

function filedOrNotApplicableValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  if (line?.source === 'not_applicable') {
    if (!line.method.trim() || !line.sources.length || line.sources.some((source) => !source.accession || !source.filed)) {
      throw new Error(`FY${year} asset-manager assumption ${name} is marked not applicable without filed provenance.`);
    }
    return 0;
  }
  return filedValue(line, name, year);
}

function optionalValue(line: CanonicalFinancialLine, name: string, year: number): number | null {
  if (line.source === 'not_applicable') return filedOrNotApplicableValue(line, name, year);
  if (line.source === 'missing') return null;
  return filedValue(line, name, year);
}

function lineSource(line: CanonicalFinancialLine, year: number): string {
  return `FY${year} ${line.method}; ${line.sources.map((source) =>
    `${source.concept || line.concept || 'derived SEC line'} (accession ${source.accession}, filed ${source.filed}, ${source.fiscal_period || 'fiscal period unavailable'})`,
  ).join('; ')}`;
}

function freshTimestamp(value: number | null | undefined, name: string): void {
  const now = Date.now();
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > now || now - value > 24 * 60 * 60 * 1000) {
    throw new Error(`A current ${name} timestamp within 24 hours is required for the asset-manager DCF.`);
  }
}

function positive(value: number | null | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Asset-manager DCF requires a positive ${name}.`);
  }
  return value;
}

function median(values: number[]): number {
  if (values.length === 0) throw new Error('Asset-manager assumptions require at least one source-backed historical observation.');
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function average(values: number[]): number {
  if (values.length === 0) throw new Error('Asset-manager assumptions require at least one source-backed historical observation.');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function historyLineValues(
  history: AssetManagerHistoricalData,
  field: keyof AssetManagerHistoricalData['annual'][number]['assetManager'],
): number[] | null {
  const values: number[] = [];
  for (const item of history.annual) {
    const line = item.assetManager[field];
    const value = optionalValue(line, field, item.year);
    if (value === null) return null;
    values.push(value);
  }
  return values;
}

function averageAssetManagerDriverRate(
  history: AssetManagerHistoricalData,
  field: 'net_flows' | 'realizations' | 'acquisitions' | 'fx_change' | 'scope_change' | 'market_change',
): number {
  const rates = history.annual.map((item) => {
    const beginningAum = filedValue(item.assetManager.beginning_aum, 'beginning AUM', item.year);
    const change = optionalValue(item.assetManager[field], field, item.year);
    if (change === null) throw new Error(`FY${item.year} asset-manager ${field} is unavailable for the filed rollforward.`);
    return change / beginningAum;
  });
  return average(rates);
}

function explicitOrHistoricalDriverRate(
  history: AssetManagerHistoricalData,
  field: 'realizations' | 'acquisitions' | 'fx_change',
): {value: number; source: string} {
  const values = historyLineValues(history, field);
  if (values === null) {
    return {
      value: 0,
      source: `Analyst input: 0.0%; the last three filings do not separately disclose a complete ${field} series. Any unclassified historical movement is preserved in the AUM scope-change line. Edit if a company-specific forecast is available.`,
    };
  }
  return {
    value: averageAssetManagerDriverRate(history, field),
    source: `Three-year arithmetic average of filed ${field} divided by beginning AUM. ${history.annual.map((item) => lineSource(item.assetManager[field], item.year)).join('; ')}`,
  };
}

function feeYieldFromHistory(
  history: AssetManagerHistoricalData,
  field: 'performance_fees' | 'capital_allocation_income' | 'securities_lending_revenue' | 'distribution_revenue',
  name: string,
): {value: number; source: string} {
  const observations: number[] = [];
  const sources: string[] = [];
  for (const item of history.annual) {
    const line = item.assetManager[field];
    const value = optionalValue(line, name, item.year);
    if (value === null) {
      return {
        value: 0,
        source: `Analyst input: 0.0% yield; this separate revenue component is not reported for all three years. The source history remains visible, and the assumption is editable.`,
      };
    }
    const averageAum = filedValue(item.assetManager.average_aum, 'average AUM', item.year);
    observations.push(value / averageAum);
    if (line.source !== 'missing' && line.source !== 'not_applicable') sources.push(lineSource(line, item.year));
  }
  return {
    value: average(observations),
    source: `Three-year average ${name} divided by filed average AUM. ${sources.join('; ')}`,
  };
}

function revenueGrowthAssumption(
  history: AssetManagerHistoricalData,
  field: 'technology_revenue' | 'administrative_other_revenue' | 'other_revenue' | 'unmapped_revenue',
  name: string,
): {value: number; source: string} {
  const values = historyLineValues(history, field);
  if (values === null) {
    return {
      value: 0,
      source: `Analyst input: 0.0% growth; no complete three-year ${name} series was filed. The separate source line remains missing and this input is editable.`,
    };
  }
  const growth = values.slice(1).map((value, index) => {
    const prior = values[index]!;
    if (prior === 0) return value === 0 ? 0 : Number.NaN;
    return value / prior - 1;
  });
  if (growth.some((value) => !Number.isFinite(value) || value <= -1 || value > 2)) {
    return {
      value: 0,
      source: `Analyst input: 0.0% growth; the filed ${name} series does not support a stable historical growth rate. The input is editable.`,
    };
  }
  const lines = history.annual.map((item) => lineSource(item.assetManager[field], item.year));
  return {value: median(growth), source: `Median of the two year-over-year growth rates in the latest three filed ${name} observations. ${lines.join('; ')}`};
}

function filedOrAnalystDriverRate(
  history: AssetManagerHistoricalData,
  field: 'acquisition_amortization',
  divisor: (year: AssetManagerHistoricalData['annual'][number]) => number,
  name: string,
): {value: number; source: string} {
  const ratios: number[] = [];
  const sources: string[] = [];
  for (const item of history.annual) {
    const value = optionalValue(item.assetManager[field], name, item.year);
    if (value === null) {
      return {value: 0, source: `Analyst input: 0.0% of revenue; no separate filed ${name} line is available for all three years.`};
    }
    ratios.push(value / divisor(item));
    if (item.assetManager[field].source !== 'missing') sources.push(lineSource(item.assetManager[field], item.year));
  }
  return {value: median(ratios), source: `Median of the latest three filed ${name} amounts as a percent of revenue. ${sources.join('; ')}`};
}

export function buildSourcedAssetManagerModelAssumptions(
  data: NativeUnifiedPayload,
  history: AssetManagerHistoricalData,
): AssetManagerModelAssumptions {
  const assumptions = buildAssetManagerAssumptionValues(data, history, false);
  if (assumptions.baseFeeYield === null) throw new Error('Three filed annual base-fee yields are required for a ready asset-manager model.');
  return {...assumptions, baseFeeYield: assumptions.baseFeeYield};
}

type AssetManagerAssumptionValues = Omit<AssetManagerModelAssumptions, 'baseFeeYield'> & {baseFeeYield: number | null};

function hasFiledBaseFeeYield(line: CanonicalFinancialLine): boolean {
  return (line.source === 'sec_native' || line.source === 'derived')
    && typeof line.value === 'number' && Number.isFinite(line.value)
    && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed);
}

function buildAssetManagerAssumptionValues(
  data: NativeUnifiedPayload,
  history: AssetManagerHistoricalData,
  allowMissingBaseFeeYield: boolean,
): AssetManagerAssumptionValues {
  if (data.canonical_financials.currency?.toUpperCase() !== 'USD') {
    throw new Error('Asset-manager AUM DCF requires USD-denominated canonical financials.');
  }
  if (history.annual.length !== 3 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Asset-manager DCF requires three aligned filed fiscal years.');
  }
  if (history.annual.some((item, index) => index > 0 && item.year !== history.annual[index - 1]!.year + 1)) {
    throw new Error('Asset-manager DCF requires three consecutive fiscal years.');
  }
  if (!['live', 'cached'].includes(data.data_quality.market.status) || data.market.fallback_used === true) {
    throw new Error('Asset-manager DCF requires a current, non-fallback market snapshot.');
  }
  if (!['live', 'cached'].includes(data.data_quality.valuation_context.status)) {
    throw new Error('Asset-manager DCF requires current risk-free and equity-risk-premium inputs.');
  }
  freshTimestamp(data.market.fetched_at_ms, 'market');
  freshTimestamp(data.valuation_context.fetched_at_ms, 'valuation context');

  const latest = history.annual.at(-1);
  const prior = history.annual.at(-2);
  if (!latest || !prior) throw new Error('Asset-manager history is incomplete.');
  const latestYear = latest.year;
  const currentRevenue = filedValue(latest.revenue, 'revenue', latestYear);
  if (currentRevenue <= 0) throw new Error(`FY${latestYear} filed revenue must be positive.`);
  const operatingMargins = history.annual.map((item) => {
    const revenue = filedValue(item.revenue, 'revenue', item.year);
    const ebit = filedValue(item.ebit, 'EBIT', item.year);
    if (revenue <= 0 || ebit <= 0) throw new Error(`FY${item.year} revenue and EBIT do not support the asset-manager model.`);
    return ebit / revenue;
  });
  const taxRates = history.annual.map((item) => filedValue(item.taxRate, 'tax rate', item.year));
  if (taxRates.some((value) => value < 0 || value > 0.5)) throw new Error('Filed effective tax rates are outside 0%–50%.');
  const aum = history.annual.map((item) => filedValue(item.assetManager.aum, 'ending AUM', item.year));
  const beginningAum = history.annual.map((item) => filedValue(item.assetManager.beginning_aum, 'beginning AUM', item.year));
  if ([...aum, ...beginningAum].some((value) => value <= 0)) throw new Error('Filed asset-manager AUM must be positive.');

  const baseFeeYieldLines = history.annual.map((item) => item.assetManager.base_fee_yield);
  const baseFeeYield = allowMissingBaseFeeYield && baseFeeYieldLines.some((line) => !hasFiledBaseFeeYield(line))
    ? null
    : average(history.annual.map((item) => filedValue(item.assetManager.base_fee_yield, 'base-fee yield', item.year)));
  const performance = feeYieldFromHistory(history, 'performance_fees', 'performance fees');
  const capitalAllocation = feeYieldFromHistory(history, 'capital_allocation_income', 'capital allocation-based income');
  const securitiesLending = feeYieldFromHistory(history, 'securities_lending_revenue', 'securities-lending revenue');
  const distribution = feeYieldFromHistory(history, 'distribution_revenue', 'distribution revenue');
  const technologyBaseLine = latest.assetManager.technology_revenue;
  const technologyRevenueBase = technologyBaseLine.source === 'missing' || technologyBaseLine.source === 'not_applicable'
    ? 0
    : filedValue(technologyBaseLine, 'technology revenue', latestYear);
  const technologyRevenueBaseSource = technologyBaseLine.source === 'missing' || technologyBaseLine.source === 'not_applicable'
    ? 'Analyst input: 0.0 revenue base because technology/subscription revenue is not separately reported. Edit this input if an issuer-specific product or platform forecast is available.'
    : lineSource(technologyBaseLine, latestYear);
  const technologyGrowth = revenueGrowthAssumption(history, 'technology_revenue', 'technology and subscription revenue');
  const administrativeOtherGrowth = revenueGrowthAssumption(history, 'administrative_other_revenue', 'administrative and other revenue');
  const otherGrowth = revenueGrowthAssumption(history, 'other_revenue', 'other advisory revenue');
  const unmappedGrowth = revenueGrowthAssumption(history, 'unmapped_revenue', 'unmapped revenue');

  const marketReturnRate = 0;
  const marketReturnSource = 'Analyst input: 0.0% annual market appreciation/depreciation. Filed 2023–2025 market movements are shown in history and are not extrapolated as a forward market forecast.';
  const netFlowRate = averageAssetManagerDriverRate(history, 'net_flows');
  const netFlowSource = `Three-year arithmetic average of filed net flows divided by beginning AUM. ${history.annual.map((item) => lineSource(item.assetManager.net_flows, item.year)).join('; ')}`;
  const realizations = explicitOrHistoricalDriverRate(history, 'realizations');
  const acquisitions = explicitOrHistoricalDriverRate(history, 'acquisitions');
  const fxChange = explicitOrHistoricalDriverRate(history, 'fx_change');
  const scopeChangeRate = 0;
  const scopeChangeSource = 'Analyst input: 0.0%; one-time AUM scope changes are displayed in filed history and not extrapolated as recurring growth.';

  const filedDepreciationRatios = history.annual.map((item) => {
    const revenue = filedValue(item.revenue, 'revenue', item.year);
    const propertyDandA = filedValue(item.assetManager.depreciation, 'depreciation and amortization', item.year);
    return propertyDandA / revenue;
  });
  if (filedDepreciationRatios.some((value) => value < 0 || value > 0.5)) {
    throw new Error('Filed depreciation and amortization intensity is outside 0%–50% of revenue.');
  }
  const capexRatios = history.annual.map((item) => {
    const revenue = filedValue(item.revenue, 'revenue', item.year);
    const capex = filedValue(item.capex, 'CapEx', item.year);
    if (capex < 0) throw new Error(`FY${item.year} CapEx cannot be negative in the asset-manager schedule.`);
    return capex / revenue;
  });
  const workingCapitalRatios = history.annual.map((item) => {
    const revenue = filedValue(item.revenue, 'revenue', item.year);
    const workingCapitalChange = filedValue(item.assetManager.working_capital_change, 'working-capital change', item.year);
    return workingCapitalChange / revenue;
  });
  if (workingCapitalRatios.some((value) => Math.abs(value) > 1)) {
    throw new Error('Filed working-capital cash-flow intensity is outside the supported range.');
  }

  const riskFreeRate = positive(data.valuation_context.risk_free_rate, 'risk-free rate');
  const equityRiskPremium = positive(data.valuation_context.equity_risk_premium, 'equity risk premium');
  const beta = positive(data.market.beta, 'market beta');
  const currentPrice = positive(data.market.current_price, 'share price');
  const marketCapitalization = positive(data.market.market_cap, 'market capitalization');
  const currentDebt = filedValue(latest.debt, 'debt', latestYear);
  const priorDebt = filedValue(prior.debt, 'debt', prior.year);
  const interestExpense = currentDebt > 0 ? filedValue(latest.interestExpense, 'interest expense', latestYear) : 0;
  const averageDebt = (currentDebt + priorDebt) / 2;
  if (currentDebt < 0 || priorDebt < 0 || (currentDebt > 0 && averageDebt <= 0)) {
    throw new Error('Filed asset-manager debt does not support a cost-of-debt calculation.');
  }
  const costOfDebt = currentDebt > 0 ? Math.abs(interestExpense) / averageDebt : 0;
  if (!Number.isFinite(costOfDebt) || costOfDebt < 0 || costOfDebt > 0.2) {
    throw new Error('Asset-manager cost of debt is outside the supported 0%–20% range.');
  }
  const equityValue = marketCapitalization;
  const totalCapital = equityValue + currentDebt;
  if (totalCapital <= 0) throw new Error('Current market equity and filed debt do not form a valid capital structure.');
  const equityWeight = equityValue / totalCapital;
  const debtWeight = currentDebt / totalCapital;
  const taxRate = median(taxRates);
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  const wacc = costOfEquity * equityWeight + costOfDebt * (1 - taxRate) * debtWeight;
  if (!Number.isFinite(wacc) || wacc < 0.02 || wacc > 0.4) throw new Error('Asset-manager WACC is outside the supported 2%–40% range.');
  const terminalGrowthRate = 0.025;
  if (terminalGrowthRate >= wacc) throw new Error('Asset-manager terminal growth must remain below the sourced WACC.');

  const sources: AssetManagerModelAssumptionSources = {
    marketReturnRate: marketReturnSource,
    netFlowRate: netFlowSource,
    realizationsRate: realizations.source,
    acquisitionRate: acquisitions.source,
    fxChangeRate: fxChange.source,
    scopeChangeRate: scopeChangeSource,
    baseFeeYield: baseFeeYield === null
      ? 'One or more filed annual base-fee yields are missing; enter each fiscal year and source on Input Required.'
      : `Three-year average of filed advisory-fee revenue divided by average AUM. ${history.annual.map((item) => lineSource(item.assetManager.base_fee_yield, item.year)).join('; ')}`,
    performanceFeeYield: performance.source,
    capitalAllocationYield: capitalAllocation.source,
    securitiesLendingYield: securitiesLending.source,
    technologyRevenueBase: technologyRevenueBaseSource,
    technologyRevenueGrowth: technologyGrowth.source,
    distributionFeeYield: distribution.source,
    administrativeOtherRevenueGrowth: administrativeOtherGrowth.source,
    otherRevenueGrowth: otherGrowth.source,
    unmappedRevenueGrowth: unmappedGrowth.source,
    operatingMargin: `Median of the latest three filed EBIT margins. ${history.annual.map((item) => `${lineSource(item.ebit, item.year)}; ${lineSource(item.revenue, item.year)}`).join('; ')}`,
    taxRate: `Median of the latest three filed effective tax rates. ${history.annual.map((item) => lineSource(item.taxRate, item.year)).join('; ')}`,
    depreciationPctRevenue: `Median of the latest three filed depreciation and amortization rows divided by consolidated revenue. ${history.annual.map((item) => `${lineSource(item.assetManager.depreciation, item.year)}; ${lineSource(item.revenue, item.year)}`).join('; ')}`,
    acquisitionAmortizationPctRevenue: `Median of filed acquisition-related amortization divided by consolidated revenue when separately disclosed. ${history.annual.map((item) => lineSource(item.assetManager.acquisition_amortization, item.year)).join('; ')}`,
    capexPctRevenue: `Median of filed capital expenditures divided by consolidated revenue. ${history.annual.map((item) => `${lineSource(item.capex, item.year)}; ${lineSource(item.revenue, item.year)}`).join('; ')}`,
    workingCapitalChangePctRevenue: `Median of filed changes in operating working capital and other operating assets/liabilities divided by consolidated revenue. ${history.annual.map((item) => `${lineSource(item.assetManager.working_capital_change, item.year)}; ${lineSource(item.revenue, item.year)}`).join('; ')}`,
    costOfDebt: currentDebt > 0
      ? `FY${latestYear} filed interest expense divided by average FY${prior.year}–FY${latestYear} debt; ${lineSource(latest.interestExpense, latestYear)}; ${lineSource(latest.debt, latestYear)}; ${lineSource(prior.debt, prior.year)}`
      : `No interest-bearing debt is reported in FY${latestYear}; the cost of debt is zero-weighted. ${lineSource(latest.debt, latestYear)}`,
    wacc: `CAPM cost of equity using risk-free rate ${riskFreeRate.toFixed(4)} from ${data.valuation_context.treasury_rate_source}, beta ${beta.toFixed(3)} from ${data.market.source}, and equity risk premium ${equityRiskPremium.toFixed(4)} from ${data.valuation_context.erp_source}; market capital weights use current market capitalization and filed debt as of ${data.valuation_context.as_of_date}.`,
    terminalGrowthRate: 'Analyst input: 2.5% perpetual FCFF growth, editable in the workbook and required to remain below WACC.',
  };

  const nonnegativeBridgeValue = (line: CanonicalFinancialLine, name: string): number => {
    const value = filedOrNotApplicableValue(line, name, latestYear);
    if (value < 0) throw new Error(`FY${latestYear} ${name} cannot be negative in the common-equity bridge.`);
    return value;
  };
  const dilutedShares = filedValue(latest.dilutedShares, 'diluted diluted shares', latestYear);
  if (dilutedShares <= 0) throw new Error(`FY${latestYear} filed diluted shares must be positive.`);
  const marketDate = data.valuation_context.as_of_date;
  if (!marketDate || !/^20\d{2}-\d{2}-\d{2}$/.test(marketDate)) {
    throw new Error('Asset-manager DCF requires a dated market/rate context.');
  }

  return {
    forecastYears: 5,
    baseYear: latestYear,
    asOfDate: marketDate,
    marketReturnRate,
    netFlowRate,
    realizationsRate: realizations.value,
    acquisitionRate: acquisitions.value,
    fxChangeRate: fxChange.value,
    scopeChangeRate,
    baseFeeYield,
    performanceFeeYield: performance.value,
    capitalAllocationYield: capitalAllocation.value,
    securitiesLendingYield: securitiesLending.value,
    technologyRevenueBase,
    technologyRevenueGrowth: technologyGrowth.value,
    distributionFeeYield: distribution.value,
    administrativeOtherRevenueGrowth: administrativeOtherGrowth.value,
    otherRevenueGrowth: otherGrowth.value,
    unmappedRevenueGrowth: unmappedGrowth.value,
    operatingMargin: median(operatingMargins),
    taxRate,
    depreciationPctRevenue: median(filedDepreciationRatios),
    acquisitionAmortizationPctRevenue: filedOrAnalystDriverRate(
      history,
      'acquisition_amortization',
      (item) => filedValue(item.revenue, 'revenue', item.year),
      'acquisition-related amortization',
    ).value,
    capexPctRevenue: median(capexRatios),
    workingCapitalChangePctRevenue: median(workingCapitalRatios),
    riskFreeRate,
    equityRiskPremium,
    beta,
    costOfDebt,
    debtWeight,
    equityWeight,
    wacc,
    terminalGrowthRate,
    currentPrice,
    marketCapitalization,
    dilutedShares,
    cash: nonnegativeBridgeValue(latest.cash, 'cash'),
    marketableSecurities: nonnegativeBridgeValue(latest.marketableSecurities, 'marketable securities'),
    debt: nonnegativeBridgeValue(latest.debt, 'debt'),
    nonControllingInterest: nonnegativeBridgeValue(latest.nonControllingInterest, 'noncontrolling interest'),
    preferredEquity: nonnegativeBridgeValue(latest.preferredEquity, 'preferred equity'),
    assumptionSources: sources,
  };
}

export function buildSourcedIncompleteAssetManagerModelAssumptions(
  data: NativeUnifiedPayload,
  history: AssetManagerHistoricalData,
): IncompleteAssetManagerModelAssumptions {
  if (!history.annual.some((item) => !hasFiledBaseFeeYield(item.assetManager.base_fee_yield))) {
    throw new Error('All three latest annual base-fee yields are filed; the asset-manager workbook should be complete.');
  }
  const assumptions = buildAssetManagerAssumptionValues(data, history, true);
  return {...assumptions, baseFeeYield: null};
}
