import type {DCFResults, PharmaHistoricalData, PharmaHistoricalYear} from '@/core/types';
import type {CanonicalFinancialLine, PharmaPatentDisclosure} from '@/core/types/native';

export interface MaturePharmaProductAssumption {
  productName: string;
  indication: string;
  usPatentExpiryYear: number | null;
  majorEuropePatentExpiryYear: number | null;
  japanPatentExpiryYear: number | null;
  pendingUsExtensionYear: number | null;
  modeledGlobalLoeYear: number | null;
  preLoeGrowthRate: number;
  firstYearErosionRate: number;
  postLoeAnnualErosionRate: number;
  sourceNote: string;
}

export interface MaturePharmaAssumptionSources {
  productGrowth: string;
  modeledGlobalLoeYear: string;
  firstYearErosionRate: string;
  postLoeAnnualErosionRate: string;
  otherRevenueGrowth: string;
  ebitMargin: string;
  taxRate: string;
  depreciationPctRevenue: string;
  capexPctRevenue: string;
  workingCapitalInvestmentPctRevenue: string;
  wacc: string;
  terminalGrowthRate: string;
  marketableSecurities: string;
}

export interface MaturePharmaModelAssumptions {
  forecastYears: number;
  baseYear: number;
  asOfDate: string;
  products: MaturePharmaProductAssumption[];
  otherRevenueBase: number;
  otherRevenueGrowth: number;
  ebitMargin: number;
  taxRate: number;
  depreciationPctRevenue: number;
  capexPctRevenue: number;
  workingCapitalInvestmentPctRevenue: number;
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  costOfDebt: number;
  debtWeight: number;
  equityWeight: number;
  wacc: number;
  terminalGrowthRate: number;
  currentPrice: number;
  marketCapitalization: number;
  commonSharesOutstanding: number;
  cash: number;
  marketableSecurities: number;
  debt: number;
  nonControllingInterest: number;
  preferredEquity: number;
  assumptionSources: MaturePharmaAssumptionSources;
}

export type IncompleteMaturePharmaProductAssumption = Omit<MaturePharmaProductAssumption, 'preLoeGrowthRate'> & {
  preLoeGrowthRate: number | null;
};

export type IncompleteMaturePharmaModelAssumptions = Omit<MaturePharmaModelAssumptions, 'products' | 'otherRevenueBase' | 'otherRevenueGrowth'> & {
  products: IncompleteMaturePharmaProductAssumption[];
  otherRevenueBase: number | null;
  otherRevenueGrowth: number | null;
};

export interface MaturePharmaForecastProduct {
  productName: string;
  revenue: number;
  modeledGlobalLoeYear: number | null;
  firstYearErosionApplied: boolean;
}

export interface MaturePharmaForecastYear {
  year: number;
  products: MaturePharmaForecastProduct[];
  mappedProductRevenue: number;
  otherRevenue: number;
  revenue: number;
  ebit: number;
  cashTaxes: number;
  nopat: number;
  depreciation: number;
  capex: number;
  workingCapitalInvestment: number;
  fcff: number;
  discountFactor: number;
  presentValueFcff: number;
  revenueReconciliationCheck: number;
  fcffIdentityCheck: number;
}

export interface MaturePharmaModelResult extends DCFResults {
  valuationBasis: 'enterprise';
  wacc: number;
  terminalGrowthUsed: number;
  maturePharmaForecasts: MaturePharmaForecastYear[];
}

function sourceValue(line: CanonicalFinancialLine | undefined, label: string, year: number): number {
  if (!line || !['sec_native', 'derived'].includes(line.source) || typeof line.value !== 'number' || !Number.isFinite(line.value)
    || !line.sources.length || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${year} PFE ${label} is missing or lacks SEC filing provenance.`);
  }
  return line.value;
}

function historyProducts(year: PharmaHistoricalYear): Map<string, {indication: string; revenue: number}> {
  const output = new Map<string, {indication: string; revenue: number}>();
  for (const item of year.pharma.products) {
    const productName = item.product_name.trim();
    if (!productName || output.has(productName)) throw new Error(`FY${year.year} PFE product revenue table has a missing or duplicate product row.`);
    output.set(productName, {
      indication: item.indication ?? '',
      revenue: sourceValue(item.revenue, `${productName} product revenue`, year.year),
    });
  }
  return output;
}

function validateHistory(history: PharmaHistoricalData): PharmaHistoricalYear[] {
  if (history.years.length !== 3 || history.annual.length !== 3
    || history.annual.some((row, index) => row.year !== history.years[index]
      || (index > 0 && row.year !== history.annual[index - 1]!.year + 1))) {
    throw new Error('PFE mature-pharma DCF requires three aligned consecutive fiscal years.');
  }
  let commonProducts: Set<string> | undefined;
  for (const row of history.annual) {
    if (row.pharma.products.length === 0) throw new Error(`FY${row.year} PFE product sales schedule is empty.`);
    const totalRevenue = sourceValue(row.pharma.reported_total_revenue, 'product-table total revenue', row.year);
    const revenue = sourceValue(row.revenue, 'consolidated revenue', row.year);
    if (Math.abs(totalRevenue - revenue) > Math.max(1_000_000, Math.abs(revenue) * 0.005)) {
      throw new Error(`FY${row.year} PFE product-table total does not reconcile to consolidated revenue.`);
    }
    const products = historyProducts(row);
    const productTotal = [...products.values()].reduce((sum, item) => sum + item.revenue, 0);
    if (productTotal <= 0 || productTotal > totalRevenue * 1.005) {
      throw new Error(`FY${row.year} PFE disclosed product rows do not reconcile to total revenue.`);
    }
    const names = new Set(products.keys());
    if (commonProducts && (commonProducts.size !== names.size || [...commonProducts].some((name) => !names.has(name)))) {
      throw new Error('PFE product rows must align across the three filed annual periods.');
    }
    commonProducts = names;
    for (const [line, label] of [
      [row.ebit, 'EBIT'], [row.taxRate, 'tax rate'], [row.depreciation, 'depreciation'],
      [row.capex, 'CapEx'], [row.nwcChange, 'working-capital investment'], [row.cash, 'cash'],
      [row.debt, 'debt'], [row.dilutedShares, 'diluted shares'],
    ] as const) sourceValue(line, label, row.year);
  }
  const latest = history.annual.at(-1)!;
  const patents = latest.pharma.patents;
  if (patents.length < 10 || patents.some((patent) => !sourceValue(patent.year, `${patent.product_name} ${patent.region} patent year`, latest.year))) {
    throw new Error('FY2025 PFE regional patent schedule is missing or incomplete.');
  }
  return history.annual;
}

function validateAssumptions(a: MaturePharmaModelAssumptions, history: PharmaHistoricalYear[]): void {
  const numeric = [
    a.otherRevenueBase, a.otherRevenueGrowth, a.ebitMargin, a.taxRate, a.depreciationPctRevenue, a.capexPctRevenue,
    a.workingCapitalInvestmentPctRevenue, a.riskFreeRate, a.equityRiskPremium, a.beta, a.costOfDebt, a.debtWeight,
    a.equityWeight, a.wacc, a.terminalGrowthRate, a.currentPrice, a.marketCapitalization, a.commonSharesOutstanding,
    a.cash, a.marketableSecurities, a.debt, a.nonControllingInterest, a.preferredEquity,
  ];
  if (a.forecastYears !== 5 || a.baseYear !== history.at(-1)!.year || numeric.some((value) => !Number.isFinite(value))) {
    throw new Error('PFE mature-pharma assumptions must be finite and match the five-year source-based model horizon.');
  }
  if (a.otherRevenueBase < 0 || Math.abs(a.otherRevenueGrowth) > 0.5 || a.ebitMargin <= -0.5 || a.ebitMargin > 0.6
    || a.taxRate < 0 || a.taxRate > 0.6 || a.depreciationPctRevenue < 0 || a.depreciationPctRevenue > 0.3
    || a.capexPctRevenue < 0 || a.capexPctRevenue > 0.3 || Math.abs(a.workingCapitalInvestmentPctRevenue) > 0.2) {
    throw new Error('PFE mature-pharma operating assumptions are outside supported ranges.');
  }
  if (a.wacc < 0.02 || a.wacc > 0.3 || a.terminalGrowthRate < 0 || a.terminalGrowthRate >= a.wacc) {
    throw new Error('PFE mature-pharma WACC must be 2%–30% and exceed terminal growth.');
  }
  if (a.currentPrice <= 0 || a.marketCapitalization <= 0 || a.commonSharesOutstanding <= 0
    || [a.cash, a.marketableSecurities, a.debt, a.nonControllingInterest, a.preferredEquity].some((value) => value < 0)) {
    throw new Error('PFE mature-pharma market or common-equity bridge inputs are outside supported ranges.');
  }
  if (!/^20\d{2}-\d{2}-\d{2}$/.test(a.asOfDate)) throw new Error('PFE mature-pharma DCF requires dated market context.');
  if (a.products.length !== history.at(-1)!.pharma.products.length) throw new Error('PFE assumptions must contain one forecast input row per filed product row.');
  const expectedNames = new Set(historyProducts(history.at(-1)!).keys());
  const seen = new Set<string>();
  for (const product of a.products) {
    if (!expectedNames.has(product.productName) || seen.has(product.productName)) throw new Error('PFE product assumptions must uniquely match filed product rows.');
    seen.add(product.productName);
    if (!Number.isFinite(product.preLoeGrowthRate) || product.preLoeGrowthRate < -0.75 || product.preLoeGrowthRate > 1.5
      || !Number.isFinite(product.firstYearErosionRate) || product.firstYearErosionRate < 0 || product.firstYearErosionRate > 0.95
      || !Number.isFinite(product.postLoeAnnualErosionRate) || product.postLoeAnnualErosionRate < 0 || product.postLoeAnnualErosionRate > 0.75
      || (product.modeledGlobalLoeYear !== null && (!Number.isInteger(product.modeledGlobalLoeYear) || product.modeledGlobalLoeYear < 2020 || product.modeledGlobalLoeYear > 2100))) {
      throw new Error(`PFE ${product.productName} growth/LOE assumptions are outside supported ranges.`);
    }
    if (!product.sourceNote.trim()) throw new Error(`PFE ${product.productName} requires a visible LOE/source note.`);
  }
  if (Object.values(a.assumptionSources).some((source) => !source.trim())) throw new Error('PFE mature-pharma assumptions require visible source/analyst disclosure.');
}

export function calculateMaturePharmaValuation(
  history: PharmaHistoricalData,
  assumptions: MaturePharmaModelAssumptions,
): MaturePharmaModelResult {
  const annual = validateHistory(history);
  validateAssumptions(assumptions, annual);
  const latest = annual.at(-1)!;
  const productBases = historyProducts(latest);
  const productAssumptions = new Map(assumptions.products.map((product) => [product.productName, product]));
  const reportedRevenue = sourceValue(latest.pharma.reported_total_revenue, 'product-table total revenue', latest.year);
  const otherRevenueBase = reportedRevenue - [...productBases.values()].reduce((sum, product) => sum + product.revenue, 0);
  if (Math.abs(otherRevenueBase - assumptions.otherRevenueBase) > Math.max(1, reportedRevenue * 1e-8)) {
    throw new Error('PFE other/alliance revenue base does not reconcile to the filed product table.');
  }

  let previousRevenue = new Map([...productBases.entries()].map(([name, product]) => [name, product.revenue]));
  let otherRevenue = otherRevenueBase;
  let sumPresentValueFcff = 0;
  const maturePharmaForecasts: MaturePharmaForecastYear[] = [];
  for (let index = 1; index <= assumptions.forecastYears; index += 1) {
    const year = latest.year + index;
    const products: MaturePharmaForecastProduct[] = [];
    for (const [name, priorRevenue] of previousRevenue) {
      const product = productAssumptions.get(name)!;
      const isLoeYear = product.modeledGlobalLoeYear !== null && year === product.modeledGlobalLoeYear;
      const hasPassedLoeYear = product.modeledGlobalLoeYear !== null && year > product.modeledGlobalLoeYear;
      const revenue = hasPassedLoeYear
        ? priorRevenue * (1 - product.postLoeAnnualErosionRate)
        : isLoeYear
          ? priorRevenue * (1 + product.preLoeGrowthRate) * (1 - product.firstYearErosionRate)
          : priorRevenue * (1 + product.preLoeGrowthRate);
      if (!Number.isFinite(revenue) || revenue < 0) throw new Error(`FY${year} PFE ${name} forecast is negative or non-finite.`);
      products.push({productName: name, revenue, modeledGlobalLoeYear: product.modeledGlobalLoeYear, firstYearErosionApplied: isLoeYear});
    }
    const mappedProductRevenue = products.reduce((sum, product) => sum + product.revenue, 0);
    otherRevenue *= 1 + assumptions.otherRevenueGrowth;
    const revenue = mappedProductRevenue + otherRevenue;
    const ebit = revenue * assumptions.ebitMargin;
    const cashTaxes = ebit * assumptions.taxRate;
    const nopat = ebit - cashTaxes;
    const depreciation = revenue * assumptions.depreciationPctRevenue;
    const capex = revenue * assumptions.capexPctRevenue;
    const workingCapitalInvestment = revenue * assumptions.workingCapitalInvestmentPctRevenue;
    const fcff = nopat + depreciation - capex - workingCapitalInvestment;
    const discountFactor = 1 / Math.pow(1 + assumptions.wacc, index);
    const presentValueFcff = fcff * discountFactor;
    const productRevenueTotal = mappedProductRevenue + otherRevenue;
    const revenueReconciliationCheck = revenue - productRevenueTotal;
    const fcffIdentityCheck = fcff - (nopat + depreciation - capex - workingCapitalInvestment);
    const values = [mappedProductRevenue, otherRevenue, revenue, ebit, cashTaxes, nopat, depreciation, capex,
      workingCapitalInvestment, fcff, discountFactor, presentValueFcff, revenueReconciliationCheck, fcffIdentityCheck];
    if (!values.every(Number.isFinite)) throw new Error(`FY${year} PFE mature-pharma forecast contains a non-finite value.`);
    maturePharmaForecasts.push({year, products, mappedProductRevenue, otherRevenue, revenue, ebit, cashTaxes, nopat,
      depreciation, capex, workingCapitalInvestment, fcff, discountFactor, presentValueFcff,
      revenueReconciliationCheck, fcffIdentityCheck});
    previousRevenue = new Map(products.map((product) => [product.productName, product.revenue]));
    sumPresentValueFcff += presentValueFcff;
  }

  const final = maturePharmaForecasts.at(-1)!;
  const terminalValue = final.fcff * (1 + assumptions.terminalGrowthRate) / (assumptions.wacc - assumptions.terminalGrowthRate);
  const pvTerminalValue = terminalValue * final.discountFactor;
  const enterpriseValue = sumPresentValueFcff + pvTerminalValue;
  const equityValue = enterpriseValue + assumptions.cash + assumptions.marketableSecurities - assumptions.debt
    - assumptions.nonControllingInterest - assumptions.preferredEquity;
  const impliedSharePrice = equityValue / assumptions.commonSharesOutstanding;
  const upside = impliedSharePrice / assumptions.currentPrice - 1;
  if (![terminalValue, pvTerminalValue, enterpriseValue, equityValue, impliedSharePrice, upside].every(Number.isFinite)
    || enterpriseValue <= 0 || equityValue <= 0 || impliedSharePrice <= 0) {
    throw new Error('PFE mature-pharma DCF returned a non-positive or non-finite equity valuation.');
  }
  return {
    forecasts: [], terminalValue, pvTerminalValue, enterpriseValue, equityValue, impliedSharePrice,
    shareCount: assumptions.commonSharesOutstanding, currentPrice: assumptions.currentPrice, upside,
    terminalValueGordon: terminalValue, terminalValueExitMultiple: 0, tvDivergenceFlag: false,
    avgROIC: 0, valueCreationFlag: false, confidenceScore: 0.58, confidenceRank: 'Medium',
    valuationBasis: 'enterprise', wacc: assumptions.wacc, terminalGrowthUsed: assumptions.terminalGrowthRate,
    maturePharmaForecasts,
  };
}
