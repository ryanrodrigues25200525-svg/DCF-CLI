import type {AssetManagerHistoricalData, CompanyProfile} from '@/core/types';
import type {AssetManagerModelAssumptions} from '@/services/valuation/asset-manager-model';
import type {AssetManagerModelExportData, DcfExportPayload, IncompleteAssetManagerModelExportData} from './types';

function sourceNote(field: string, year: number, line: {value: number | null; method: string; concept: string | null; sources: Array<{
  concept: string | null;
  accession: string | null;
  filed: string | null;
  fiscal_period?: string | null;
  unit?: string | null;
  unit_scale?: string | null;
}>}): string {
  const sources = line.sources.map((source) => {
    const unit = source.unit_scale ? `${source.unit || 'unit unknown'} ${source.unit_scale}` : source.unit || 'unit unavailable';
    return `${source.concept || line.concept || 'derived SEC line'}, accession ${source.accession || 'unresolved'}, filed ${source.filed || 'unresolved'}, ${source.fiscal_period || 'period unavailable'}, ${unit}`;
  }).join('; ');
  return `FY${year} ${field}: ${line.method}; value ${line.value ?? 'missing'}; ${sources || 'no source record'}`;
}

function filedLineNotes(history: AssetManagerHistoricalData): string[] {
  return history.annual.flatMap((item) => [
    ...Object.entries(item.assetManager).map(([field, line]) => sourceNote(field, item.year, line)),
    sourceNote('revenue', item.year, item.revenue),
    sourceNote('EBIT', item.year, item.ebit),
    sourceNote('interest expense', item.year, item.interestExpense),
    sourceNote('effective tax rate', item.year, item.taxRate),
    sourceNote('CapEx', item.year, item.capex),
    sourceNote('cash', item.year, item.cash),
    sourceNote('marketable securities', item.year, item.marketableSecurities),
    sourceNote('debt', item.year, item.debt),
    sourceNote('noncontrolling interest', item.year, item.nonControllingInterest),
    sourceNote('preferred equity', item.year, item.preferredEquity),
    sourceNote('diluted shares', item.year, item.dilutedShares),
  ]);
}

export function buildIncompleteAssetManagerModelExportData(
  history: AssetManagerHistoricalData,
  assumptions: IncompleteAssetManagerModelExportData['assumptions'],
): IncompleteAssetManagerModelExportData {
  if (history.annual.length !== 3 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Incomplete asset-manager workbook requires three aligned annual periods.');
  }
  const hasMissingYield = history.annual.some((item) => {
    const line = item.assetManager.base_fee_yield;
    return !(['sec_native', 'derived'].includes(line.source)
      && typeof line.value === 'number' && Number.isFinite(line.value)
      && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed));
  });
  if (!hasMissingYield) throw new Error('Incomplete asset-manager workbook requires a missing annual base-fee yield.');
  return {history, assumptions};
}

export function buildAssetManagerModelExportPayload(
  company: CompanyProfile,
  history: AssetManagerHistoricalData,
  assumptions: AssetManagerModelAssumptions,
): DcfExportPayload {
  if (history.annual.length !== 3 || history.annual.some((item, index) => item.year !== history.years[index])) {
    throw new Error('Asset-manager workbook requires three aligned years of filed AUM, fees, and operating inputs.');
  }
  const latest = history.annual.at(-1);
  if (!latest || latest.year !== assumptions.baseYear || latest.year !== history.years.at(-1)) {
    throw new Error('Asset-manager workbook history, base year, and source fiscal periods do not align.');
  }
  if (history.annual.some((item, index) => index > 0 && item.year !== history.annual[index - 1]!.year + 1)) {
    throw new Error('Asset-manager workbook requires three consecutive fiscal years.');
  }

  const assetManagerModel: AssetManagerModelExportData = {history, assumptions};
  const sourceNotes = filedLineNotes(history);
  for (const [name, source] of Object.entries(assumptions.assumptionSources)) {
    sourceNotes.push(`${name} assumption: ${source}.`);
  }
  sourceNotes.push(
    `Risk-free rate ${assumptions.riskFreeRate.toFixed(4)}, ERP ${assumptions.equityRiskPremium.toFixed(4)}, beta ${assumptions.beta.toFixed(3)}, cost of debt ${assumptions.costOfDebt.toFixed(4)}, and WACC ${assumptions.wacc.toFixed(4)} as of ${assumptions.asOfDate}.`,
    'Base AUM is the latest filed annual period. The forecast market-return assumption is an explicit analyst input and is not presented as issuer guidance.',
    `Starting operating and AUM actuals are FY${latest.year}; the model does not incorporate 2026 quarterly AUM or fee changes.`,
    'Operating lease expense remains in filed EBIT and the operating-margin forecast; operating lease liabilities are excluded from the enterprise-to-common-equity bridge to avoid double counting.',
    'The primary valuation is an unlevered FCFF DCF using Gordon growth. No peer exit-multiple cross-check is included because a current curated traditional-manager peer set is not part of this model input.',
  );

  const missingComponents = history.annual.at(-1)?.assetManager
    ? Object.entries(history.annual.at(-1)!.assetManager)
      .filter(([field, line]) => ['capital_allocation_income', 'securities_lending_revenue', 'technology_revenue', 'distribution_revenue', 'administrative_other_revenue', 'other_revenue'].includes(field)
        && line.source === 'missing')
      .map(([field]) => field)
    : [];

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
    },
    valuationModel: 'asset_manager_aum_dcf',
    assetManagerModel,
    market: {
      currentPrice: assumptions.currentPrice,
      sharesDiluted: assumptions.dilutedShares,
      marketCap: assumptions.marketCapitalization,
      cash: assumptions.cash,
      debt: assumptions.debt,
      minorityInterest: assumptions.nonControllingInterest,
      preferredEquity: assumptions.preferredEquity,
      nonOperatingAssets: assumptions.marketableSecurities,
    },
    historicals: {
      years: history.years,
      income: {},
      balance: {},
      cashflow: {},
    },
    assumptions: {
      scenarioMode: 'Base',
      horizonYears: assumptions.forecastYears,
      revenueMethod: 'TopDown',
      taxRate: assumptions.taxRate,
      capexMethod: '%Revenue',
      capexPctRevenue: assumptions.capexPctRevenue,
      daMethod: '%Revenue',
      daPctRevenue: assumptions.depreciationPctRevenue + assumptions.acquisitionAmortizationPctRevenue,
      wcMethod: 'NWC_%Revenue',
      nwcPctRevenue: assumptions.workingCapitalChangePctRevenue,
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
      terminal: {
        method: 'Perpetuity',
        g: assumptions.terminalGrowthRate,
      },
    },
    forecasts: [],
    uiMeta: {
      printDate: new Date().toISOString().slice(0, 10),
      companyName: company.name,
      currency: company.currency || 'USD',
      confidenceLabel: 'Medium',
      confidenceScore: 0.75,
      warnings: [
        `The model uses FY${latest.year} annual operating results and year-end AUM; filed 2026 quarterly AUM and fee changes are not incorporated.`,
        ...(missingComponents.length > 0
          ? [`These fee components are not separately reported in the latest mapped filing and remain visible as source gaps: ${missingComponents.join(', ')}.`]
          : []),
      ],
      sourceNotes,
    },
  };
}
