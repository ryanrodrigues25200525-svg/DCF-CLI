import type {CompanyProfile, EnergyHistoricalData} from '@/core/types';
import type {DcfExportPayload, IncompleteIntegratedEnergyModelExportData, IntegratedEnergyModelExportData} from './types';
import type {IncompleteIntegratedEnergyAssumptions, IntegratedEnergyAssumptionSources, IntegratedEnergyAssumptions} from '@/services/valuation/integrated-energy-model';

function sourceNote(
  field: string,
  year: number,
  line: {value: number | null; method: string; concept: string | null; sources: Array<{
    concept: string | null;
    accession: string | null;
    filed: string | null;
    fiscal_period?: string | null;
    unit?: string | null;
    unit_scale?: string | null;
  }>},
): string {
  const sources = line.sources.map((source) => `${source.concept || line.concept || 'filed SEC line'}; accession ${source.accession || 'unresolved'}; filed ${source.filed || 'unresolved'}; ${source.fiscal_period || 'period unavailable'}; ${source.unit || 'unit unavailable'} ${source.unit_scale || ''}`).join('; ');
  return `FY${year} ${field}: ${line.method}; value ${line.value ?? 'missing'}; ${sources || 'no source record'}`;
}

export function buildIncompleteIntegratedEnergyModelExportData(
  history: EnergyHistoricalData,
  assumptions: IncompleteIntegratedEnergyAssumptions,
): IncompleteIntegratedEnergyModelExportData {
  if (history.annual.length !== 3 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Incomplete integrated-energy workbook requires three aligned annual periods.');
  }
  const latest = history.annual.at(-1);
  if (!latest || (latest.energy.crude_oil_production.source === 'sec_native'
    || latest.energy.crude_oil_production.source === 'derived')
    && typeof latest.energy.crude_oil_production.value === 'number') {
    throw new Error('Incomplete integrated-energy workbook requires missing latest filed crude production.');
  }
  return {history, assumptions};
}

export function buildIntegratedEnergyModelExportPayload(
  company: CompanyProfile,
  history: EnergyHistoricalData,
  assumptions: IntegratedEnergyAssumptions,
): DcfExportPayload {
  if (history.annual.length !== 3 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Integrated-energy workbook requires three aligned annual years.');
  }
  const latest = history.annual.at(-1);
  if (!latest || latest.year !== assumptions.baseYear || latest.year !== history.years.at(-1)) {
    throw new Error('Integrated-energy history, base year, and SEC filing periods do not align.');
  }
  const sourceNotes: string[] = [];
  for (const item of history.annual) {
    sourceNotes.push(...Object.entries(item.energy).map(([field, line]) => sourceNote(`energy.${field}`, item.year, line)));
    for (const [field, line] of Object.entries({
      revenue: item.revenue,
      net_income: item.netIncome,
      interest_expense: item.interestExpense,
      effective_tax_rate: item.taxRate,
      depreciation_and_depletion: item.depreciation,
      cash_flow_from_operations: item.cashFlowFromOperations,
      cash: item.cash,
      current_debt: item.currentDebt,
      long_term_debt: item.longTermDebt,
      total_interest_bearing_debt: item.debt,
      marketable_securities: item.marketableSecurities,
      preferred_equity: item.preferredEquity,
      non_controlling_interest: item.nonControllingInterest,
      weighted_average_diluted_shares: item.dilutedShares,
    })) sourceNotes.push(sourceNote(field, item.year, line));
  }
  for (const [name, source] of Object.entries(assumptions.assumptionSources satisfies IntegratedEnergyAssumptionSources)) {
    sourceNotes.push(`${name} assumption: ${source}.`);
  }
  sourceNotes.push(
    `Dated WACC ${assumptions.wacc.toFixed(4)}; CAPM cost of equity ${(assumptions.riskFreeRate + assumptions.beta * assumptions.equityRiskPremium).toFixed(4)}; WACC inputs as of ${assumptions.asOfDate}.`,
    `FY${latest.year} is the latest annual operating base. The model does not include later quarterly production, earnings, cash-flow, or debt updates.`,
    'The Upstream schedule forecasts filed crude, NGL, bitumen, synthetic-oil and gas volumes, total realized prices, and production costs. Its earnings conversion factor is calibrated to reported Upstream GAAP earnings and the filed production-economics proxy.',
    'Filed Brent, Henry Hub, and TTF earnings sensitivities appear as independent checks. They do not replace the model\u2019s production-price-cost calculation.',
    'Cash CapEx uses the SEC-reported non-GAAP Cash CapEx reconciliation. Note 3 segment PP&E additions are presented separately and include noncash additions, including acquisition-related amounts.',
    'Operating working-capital investment is derived from four filed cash-flow impacts: receivables, inventory, other current assets, and accounts/other payables.',
    'No separate marketable-securities adjustment is added because equity-company production and earnings are included in the segment forecast; adding the combined investments-and-advances line would double count those operating assets.',
    'The proved-reserve roll-forward is a production consistency check and is not valued as a separate reserve NAV.',
    'The terminal method is Gordon growth; terminal growth must remain below WACC.',
  );

  const integratedEnergyModel: IntegratedEnergyModelExportData = {history, assumptions};
  return {
    company: {
      name: company.name,
      ticker: company.ticker,
      exchange: company.exchange,
      cik: company.cik,
      currency: company.currency || 'USD',
      unitsScale: 'units',
      asOfDate: assumptions.asOfDate,
      fiscalYearEnd: company.fiscalYearEnd,
      sector: company.sector,
      industry: company.industry,
      operatingArchetype: 'energy_materials',
    },
    valuationModel: 'integrated_energy_dcf',
    integratedEnergyModel,
    market: {
      currentPrice: assumptions.currentPrice,
      sharesDiluted: assumptions.commonSharesOutstanding,
      marketCap: assumptions.marketCapitalization,
      cash: assumptions.cash,
      debt: assumptions.debt,
      minorityInterest: assumptions.nonControllingInterest,
      preferredEquity: assumptions.preferredEquity,
      nonOperatingAssets: assumptions.marketableSecurities,
    },
    historicals: {years: history.years, income: {}, balance: {}, cashflow: {}},
    assumptions: {
      scenarioMode: 'Base',
      horizonYears: assumptions.forecastYears,
      revenueMethod: 'TopDown',
      taxRate: assumptions.taxRate,
      capexMethod: '%Revenue',
      capexPctRevenue: assumptions.cashCapexPctRevenue,
      daMethod: '%Revenue',
      daPctRevenue: assumptions.depreciationPctRevenue,
      wcMethod: 'NWC_%Revenue',
      nwcPctRevenue: assumptions.workingCapitalInvestmentPctRevenue,
      wacc: {
        rf: assumptions.riskFreeRate,
        erp: assumptions.equityRiskPremium,
        beta: assumptions.beta,
        betaSource: assumptions.assumptionSources.wacc,
        costOfDebt: assumptions.costOfDebt,
        debtWeight: assumptions.debtWeight,
        equityWeight: assumptions.equityWeight,
      },
      waccRate: assumptions.wacc,
      terminal: {method: 'Perpetuity', g: assumptions.terminalGrowthRate},
    },
    forecasts: [],
    uiMeta: {
      printDate: new Date().toISOString().slice(0, 10),
      companyName: company.name,
      currency: company.currency || 'USD',
      confidenceLabel: 'Medium',
      confidenceScore: 0.62,
      warnings: [
        `The integrated-energy DCF starts from FY${latest.year} annual actuals; later quarterly operating and balance-sheet updates are outside this release.`,
        'The issuer-provided earnings sensitivity is displayed as a separate check and is not used as the upstream segment earnings forecast.',
      ],
      sourceNotes,
    },
  };
}
