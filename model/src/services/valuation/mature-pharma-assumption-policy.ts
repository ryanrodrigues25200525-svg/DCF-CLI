import type {CanonicalFinancialLine, NativeUnifiedPayload, PharmaPatentDisclosure} from '@/core/types/native';
import type {PharmaHistoricalData} from '@/core/types';
import type {IncompleteMaturePharmaModelAssumptions, IncompleteMaturePharmaProductAssumption, MaturePharmaModelAssumptions, MaturePharmaProductAssumption} from './mature-pharma-model';
import { median as medianOf, requireFiledValue } from '@/services/valuation/source-guards';

function filedValue(line: CanonicalFinancialLine | undefined, name: string, year: number): number {
  return requireFiledValue(line, name, year, 'PFE');
}
function median(values: number[], name: string): number {
  return medianOf(values, {label: 'PFE', name});
}
function requiredPositive(value: number | null | undefined, name: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`PFE mature-pharma DCF requires positive ${name}.`);
  return value;
}

function normalizeName(value: string): string {
  return value.toLowerCase().replace(/\s*\([a-z0-9]+\)\s*$/i, '').replace(/[^a-z0-9]/g, '');
}

function patentNamesForProduct(productName: string): string[] {
  const key = normalizeName(productName);
  if (key === 'prevnarfamily') return ['Prevnar 13/Prevenar 13', 'Prevnar 20/Prevenar 20'];
  if (key === 'vyndaqelfamily') return ['Vyndaqel/Vyndamax/Vynmac'];
  if (key === 'braftovimektovi') return ['Braftovi (11)', 'Mektovi (11)'];
  return [productName];
}

function findPatent(
  patents: PharmaPatentDisclosure[],
  productName: string,
  region: PharmaPatentDisclosure['region'],
  metric: PharmaPatentDisclosure['metric'],
): number | null {
  const names = patentNamesForProduct(productName).map(normalizeName);
  const values = patents.filter((patent) => names.includes(normalizeName(patent.product_name))
    && patent.region === region && patent.metric === metric)
    .map((patent) => patent.year.value)
    .filter((value): value is number => typeof value === 'number');
  return values.length ? Math.min(...values) : null;
}

function productAssumptions(history: PharmaHistoricalData, allowMissingProductRevenue = false): IncompleteMaturePharmaProductAssumption[] {
  const recent = history.annual;
  const latest = recent.at(-1)!;
  return latest.pharma.products.map((product) => {
    const revenues = recent.map((row) => {
      const matching = row.pharma.products.find((line) => line.product_name === product.product_name);
      if (!matching) throw new Error(`PFE ${product.product_name} is not aligned across FY2023–FY2025 product tables.`);
      const line = matching.revenue;
      const isFiled = (line.source === 'sec_native' || line.source === 'derived')
        && typeof line.value === 'number' && Number.isFinite(line.value)
        && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed);
      if (isFiled) return line.value!;
      if (allowMissingProductRevenue) return null;
      return filedValue(line, `${product.product_name} product revenue`, row.year);
    });
    const filedRevenues = revenues.filter((value): value is number => value !== null);
    const missingRevenue = filedRevenues.length !== revenues.length;
    const cagr = !missingRevenue && filedRevenues[0]! > 0 ? Math.pow(filedRevenues.at(-1)! / filedRevenues[0]!, 1 / (recent.length - 1)) - 1 : Number.NaN;
    const latestYearGrowth = !missingRevenue && filedRevenues[1]! > 0 ? filedRevenues[2]! / filedRevenues[1]! - 1 : Number.NaN;
    const growthIsValid = Number.isFinite(cagr) && cagr >= -0.75 && cagr <= 1.5;
    const latestGrowthIsValid = Number.isFinite(latestYearGrowth) && latestYearGrowth >= -0.75 && latestYearGrowth <= 1.5;
    const historicalGrowth = missingRevenue
      ? []
      : filedRevenues.slice(1).map((value, index) => filedRevenues[index]! > 0 ? value / filedRevenues[index]! - 1 : 0);
    const directionReversal = historicalGrowth[0]! * historicalGrowth[1]! < 0
      && Math.max(Math.abs(historicalGrowth[0]!), Math.abs(historicalGrowth[1]!)) > 0.25;
    const covidProduct = `${product.product_name} ${product.indication ?? ''}`.toLowerCase().includes('covid');
    const useLatestGrowth = covidProduct || directionReversal || !growthIsValid;
    const preLoeGrowthRate = missingRevenue ? null : useLatestGrowth
      ? latestGrowthIsValid ? latestYearGrowth : 0
      : growthIsValid ? cagr : 0;
    const usPatentExpiryYear = findPatent(latest.pharma.patents, product.product_name, 'us', 'basic_patent_expiration_year');
    const majorEuropePatentExpiryYear = findPatent(latest.pharma.patents, product.product_name, 'major_europe', 'basic_patent_expiration_year');
    const japanPatentExpiryYear = findPatent(latest.pharma.patents, product.product_name, 'japan', 'basic_patent_expiration_year');
    const pendingUsExtensionYear = findPatent(latest.pharma.patents, product.product_name, 'us', 'pending_patent_term_extension_year');
    const aliasNote = patentNamesForProduct(product.product_name).length > 1
      ? `The product table groups this family; the U.S. timing proxy uses the earliest patent year among ${patentNamesForProduct(product.product_name).join(' and ')}.`
      : '';
    const loeNote = usPatentExpiryYear === null
      ? 'No matching U.S. basic patent row was disclosed for this product-table label; no LOE event is modeled unless the analyst enters one.'
      : `Modeled global LOE year is initialized from the filed U.S. basic patent year ${usPatentExpiryYear}; Pfizer does not disclose product-level sales by patent territory or expected generic-entry dates. ${aliasNote}`;
    const growthNote = missingRevenue
      ? 'A filed product-revenue year is missing; pre-LOE growth is calculated by the visible workbook formula after the required revenue input is restored.'
      : useLatestGrowth && latestGrowthIsValid
      ? covidProduct
        ? 'Pre-LOE growth starts from latest FY2024–FY2025 filed year-over-year sales because COVID product sales are unusually volatile.'
        : 'Three-year growth is distorted or reverses direction; pre-LOE growth starts from the latest filed year-over-year change.'
      : growthIsValid
        ? 'Pre-LOE growth starts from the FY2023–FY2025 filed revenue CAGR.'
        : 'Historical product growth is outside model bounds; pre-LOE growth starts at 0% as an explicit analyst input requiring review.';
    const extensionNote = pendingUsExtensionYear === null
      ? ''
      : ` A pending U.S. patent-term extension to ${pendingUsExtensionYear} is disclosed separately and is not assumed approved.`;
    return {
      productName: product.product_name,
      indication: product.indication ?? '',
      usPatentExpiryYear,
      majorEuropePatentExpiryYear,
      japanPatentExpiryYear,
      pendingUsExtensionYear,
      modeledGlobalLoeYear: usPatentExpiryYear,
      preLoeGrowthRate,
      firstYearErosionRate: 0.5,
      postLoeAnnualErosionRate: 0.15,
      sourceNote: `${loeNote}${extensionNote} ${growthNote} Growth and erosion assumptions are editable and are not Pfizer guidance.`,
    };
  });
}

export function buildSourcedMaturePharmaModelAssumptions(
  data: NativeUnifiedPayload,
  history: PharmaHistoricalData,
): MaturePharmaModelAssumptions {
  const assumptions = buildMaturePharmaAssumptionValues(data, history, false);
  if (assumptions.otherRevenueBase === null || assumptions.otherRevenueGrowth === null
    || assumptions.products.some((product) => product.preLoeGrowthRate === null)) {
    throw new Error('Complete product sales history is required for a ready mature-pharma model.');
  }
  return {
    ...assumptions,
    otherRevenueBase: assumptions.otherRevenueBase,
    otherRevenueGrowth: assumptions.otherRevenueGrowth,
    products: assumptions.products as MaturePharmaProductAssumption[],
  };
}

type MaturePharmaAssumptionValues = Omit<MaturePharmaModelAssumptions, 'products' | 'otherRevenueBase' | 'otherRevenueGrowth'> & {
  products: IncompleteMaturePharmaProductAssumption[];
  otherRevenueBase: number | null;
  otherRevenueGrowth: number | null;
};

function hasFiledProductRevenue(line: CanonicalFinancialLine): boolean {
  return (line.source === 'sec_native' || line.source === 'derived')
    && typeof line.value === 'number' && Number.isFinite(line.value)
    && line.sources.length > 0 && line.sources.every((source) => source.accession && source.filed);
}

function buildMaturePharmaAssumptionValues(
  data: NativeUnifiedPayload,
  history: PharmaHistoricalData,
  allowMissingProductRevenue: boolean,
): MaturePharmaAssumptionValues {
  if (data.profile.ticker?.toUpperCase() !== 'PFE') throw new Error('The initial mature-pharma route is issuer-specific to Pfizer.');
  if (data.canonical_financials.currency?.toUpperCase() !== 'USD') throw new Error('Mature-pharma DCF requires USD-denominated financials.');
  if (history.annual.length !== 3 || history.years.length !== 3
    || history.annual.some((row, index) => row.year !== history.years[index]
      || (index > 0 && row.year !== history.annual[index - 1]!.year + 1))) {
    throw new Error('PFE mature-pharma DCF requires three aligned consecutive fiscal years.');
  }
  if (!['live', 'cached'].includes(data.data_quality.market.status) || data.market.fallback_used === true
    || !['live', 'cached'].includes(data.data_quality.valuation_context.status)) {
    throw new Error('PFE mature-pharma DCF requires current non-fallback market and WACC inputs.');
  }
  const requireFresh = (timestamp: number | null | undefined, name: string) => {
    const now = Date.now();
    if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0 || timestamp > now || now - timestamp > 24 * 60 * 60 * 1000) {
      throw new Error(`PFE mature-pharma DCF requires a ${name} timestamp within 24 hours.`);
    }
  };
  requireFresh(data.market.fetched_at_ms, 'market');
  requireFresh(data.valuation_context.fetched_at_ms, 'valuation-context');
  const latest = history.annual.at(-1)!;
  const currentPrice = requiredPositive(data.market.current_price, 'share price');
  const marketCapitalization = requiredPositive(data.market.market_cap, 'market capitalization');
  const commonSharesOutstanding = requiredPositive(data.market.shares_outstanding, 'shares outstanding');
  const riskFreeRate = requiredPositive(data.valuation_context.risk_free_rate, 'risk-free rate');
  const equityRiskPremium = requiredPositive(data.valuation_context.equity_risk_premium, 'equity risk premium');
  const beta = requiredPositive(data.market.beta, 'beta');
  const revenues = history.annual.map((row) => filedValue(row.pharma.reported_total_revenue, 'reported total revenue', row.year));
  const ebitMargin = median(history.annual.map((row, index) => filedValue(row.ebit, 'EBIT', row.year) / revenues[index]!), 'three-year GAAP EBIT margin');
  const taxRate = 0.21;
  const depreciationPctRevenue = median(history.annual.map((row, index) =>
    Math.abs(filedValue(row.depreciation, 'depreciation', row.year)) / revenues[index]!), 'D&A as a percent of revenue');
  const capexPctRevenue = median(history.annual.map((row, index) =>
    Math.abs(filedValue(row.capex, 'CapEx', row.year)) / revenues[index]!), 'CapEx as a percent of revenue');
  const workingCapitalInvestmentPctRevenue = median(history.annual.map((row, index) =>
    filedValue(row.nwcChange, 'working-capital investment', row.year) / revenues[index]!), 'working-capital investment as a percent of revenue');
  const debtBalances = history.annual.map((row) => filedValue(row.debt, 'interest-bearing debt', row.year));
  const debt = debtBalances.at(-1)!;
  const costOfDebt = median(history.annual.slice(1).map((row, index) => {
    const averageDebt = (debtBalances[index]! + debtBalances[index + 1]!) / 2;
    if (averageDebt <= 0) throw new Error(`PFE FY${row.year} average debt must be positive.`);
    return Math.abs(filedValue(row.interestExpense, 'interest expense', row.year)) / averageDebt;
  }), 'interest expense divided by average debt');
  const debtWeight = debt / (marketCapitalization + debt);
  const equityWeight = 1 - debtWeight;
  const costOfEquity = riskFreeRate + beta * equityRiskPremium;
  const wacc = equityWeight * costOfEquity + debtWeight * costOfDebt * (1 - taxRate);
  const terminalGrowthRate = 0.025;
  if (wacc < 0.02 || wacc > 0.3 || terminalGrowthRate >= wacc) throw new Error('PFE mature-pharma WACC must exceed terminal growth.');

  const latestRevenue = revenues.at(-1)!;
  const latestProductRevenues = latest.pharma.products.map((product) => {
    if (allowMissingProductRevenue && !hasFiledProductRevenue(product.revenue)) return null;
    return filedValue(product.revenue, `${product.product_name} product revenue`, latest.year);
  });
  const filedLatestProductRevenues = latestProductRevenues.filter((value): value is number => value !== null);
  const otherRevenueBase = filedLatestProductRevenues.length !== latestProductRevenues.length
    ? null
    : latestRevenue - filedLatestProductRevenues.reduce((sum, value) => sum + value, 0);
  if (otherRevenueBase !== null && otherRevenueBase < 0) throw new Error('PFE filed product rows exceed total revenue.');
  const residualHistory = history.annual.map((row) => {
    const total = filedValue(row.pharma.reported_total_revenue, 'reported total revenue', row.year);
    const productRevenues = row.pharma.products.map((product) => {
      if (allowMissingProductRevenue && !hasFiledProductRevenue(product.revenue)) return null;
      return filedValue(product.revenue, `${product.product_name} product revenue`, row.year);
    });
    const filedProductRevenues = productRevenues.filter((value): value is number => value !== null);
    return filedProductRevenues.length !== productRevenues.length
      ? null
      : total - filedProductRevenues.reduce((sum, value) => sum + value, 0);
  });
  const missingProductRevenue = residualHistory.some((value) => value === null);
  const cagrOtherRevenue = !missingProductRevenue && residualHistory[0]! > 0
    ? Math.pow(residualHistory.at(-1)! / residualHistory[0]!, 1 / (history.annual.length - 1)) - 1
    : missingProductRevenue ? Number.NaN : 0;
  const recentOtherGrowth = !missingProductRevenue && residualHistory[1]! > 0 ? residualHistory[2]! / residualHistory[1]! - 1 : Number.NaN;
  const otherRevenueGrowth = missingProductRevenue ? null : Number.isFinite(cagrOtherRevenue) && Math.abs(cagrOtherRevenue) <= 0.5
    ? cagrOtherRevenue
    : Number.isFinite(recentOtherGrowth) && Math.abs(recentOtherGrowth) <= 0.5 ? recentOtherGrowth : 0;
  const bridge = (line: CanonicalFinancialLine, label: string): number => {
    if (line.source === 'not_applicable' && line.sources.length > 0) return 0;
    return filedValue(line, label, latest.year);
  };
  const products = productAssumptions(history, allowMissingProductRevenue);
  const sources = {
    productGrowth: 'Each product starts from its FY2023–FY2025 filed CAGR; COVID products, direction-reversal series, or out-of-range CAGRs use the latest filed year-over-year change instead.',
    modeledGlobalLoeYear: 'Editable analyst proxy initialized from the filed U.S. basic patent expiration; regional sales mix and generic-entry timing are not disclosed per product.',
    firstYearErosionRate: 'Analyst base-case assumption: 50% sales decline in the modeled global LOE year; editable by product, not Pfizer guidance.',
    postLoeAnnualErosionRate: 'Analyst base-case assumption: 15% annual decline after the modeled LOE year; editable by product, not Pfizer guidance.',
    otherRevenueGrowth: otherRevenueGrowth === null
      ? 'A filed product-revenue line is missing; growth in the other/alliance revenue residual is calculated by formula after the source input is restored.'
      : 'Filed consolidated total revenue less detailed product rows, including alliance, royalty, and other unallocated revenue; starts from historical residual CAGR.',
    ebitMargin: 'Median FY2023–FY2025 GAAP EBIT / filed consolidated total revenue; editable and retains historical GAAP charges in actuals.',
    taxRate: 'Analyst starting point: 21% U.S. federal corporate statutory rate per IRS Publication 542 (https://www.irs.gov/publications/p542); Pfizer global tax mix and tax attributes can differ.',
    depreciationPctRevenue: 'Median FY2023–FY2025 filed D&A / consolidated total revenue.',
    capexPctRevenue: 'Median FY2023–FY2025 filed PP&E purchases / consolidated total revenue.',
    workingCapitalInvestmentPctRevenue: 'Median FY2023–FY2025 filed cash-flow-derived operating working-capital investment / consolidated total revenue.',
    wacc: `CAPM uses risk-free rate ${riskFreeRate.toFixed(4)}, beta ${beta.toFixed(3)}, ERP ${equityRiskPremium.toFixed(4)}, current market capitalization, filed debt, and the editable tax assumption as of ${data.valuation_context.as_of_date}.`,
    terminalGrowthRate: 'Analyst input: 2.5% perpetual FCFF growth, editable and required to remain below WACC.',
    marketableSecurities: 'Uses FY2025 filed short-term investments in the common-equity bridge. Long-term equity-method/private investments are not included in cash-like assets.',
  };
  return {
    forecastYears: 5,
    baseYear: latest.year,
    asOfDate: String(data.valuation_context.as_of_date),
    products,
    otherRevenueBase,
    otherRevenueGrowth,
    ebitMargin,
    taxRate,
    depreciationPctRevenue,
    capexPctRevenue,
    workingCapitalInvestmentPctRevenue,
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
    commonSharesOutstanding,
    cash: filedValue(latest.cash, 'cash', latest.year),
    marketableSecurities: filedValue(latest.marketableSecurities, 'short-term investments', latest.year),
    debt,
    nonControllingInterest: bridge(latest.nonControllingInterest, 'noncontrolling interest'),
    preferredEquity: bridge(latest.preferredEquity, 'preferred equity'),
    assumptionSources: sources,
  };
}

export function buildSourcedIncompleteMaturePharmaModelAssumptions(
  data: NativeUnifiedPayload,
  history: PharmaHistoricalData,
): IncompleteMaturePharmaModelAssumptions {
  const hasMissingProductRevenue = history.annual.some((year) =>
    year.pharma.products.some((product) => !hasFiledProductRevenue(product.revenue)));
  if (!hasMissingProductRevenue) throw new Error('PFE product sales are fully filed; the workbook should be complete.');
  return buildMaturePharmaAssumptionValues(data, history, true);
}
