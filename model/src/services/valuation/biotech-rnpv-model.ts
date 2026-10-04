import type {DCFResults} from '@/core/types';
import type {PipelineAssetNativeFact} from '@/core/types/native';

const BIOTECH_FORECAST_YEARS = 10;
const BIOTECH_PIPELINE_FORECAST_YEARS = 35;

export interface BiotechAssetRnpvInput {
  assetId: string;
  include: number;
  launchYear: number;
  peakSales: number;
  yearsToPeak: number;
  exclusivityYear: number;
  postLoeErosion: number;
  probabilityOfSuccess: number;
  retainedShare: number;
  contributionMargin: number;
  developmentCostPv: number;
}

export function selectBiotechAssetsForRnpv(assets: readonly PipelineAssetNativeFact[]): PipelineAssetNativeFact[] {
  return assets.filter((asset) => asset.development_status !== 'explicitly_paused'
    && typeof asset.stage === 'string'
    && /(?:phase\s*(?:[2-3]|1\s*\/\s*[2-3])|registrational|regulatory)/i.test(asset.stage));
}

export function selectOtherBiotechAssetsForRnpv(assets: readonly PipelineAssetNativeFact[]): PipelineAssetNativeFact[] {
  const modeledIds = new Set(selectBiotechAssetsForRnpv(assets).map((asset) => asset.asset_id));
  return assets.filter((asset) => !modeledIds.has(asset.asset_id));
}

export interface BiotechRnpvAssumptions {
  baseYear: number;
  commercialRevenueBase: number;
  commercialRevenueGrowth: number[];
  commercialFcfMargin: number;
  otherPipelineRnpv: number;
  terminalGrowthRate: number;
  riskFreeRate: number;
  equityRiskPremium: number;
  beta: number;
  costOfDebt: number;
  normalizedTaxRate: number;
  marketCapitalization: number;
  dilutedShares: number;
  currentPrice: number;
  cash: number;
  marketableSecurities: number;
  debt: number;
  preferredEquity: number;
  nonControllingInterest: number;
  assets: BiotechAssetRnpvInput[];
}

export interface BiotechRnpvForecastYear {
  year: number;
  commercialRevenue: number;
  commercialFcf: number;
  riskAdjustedPipelineFcf: number;
  totalFcf: number;
  discountFactor: number;
  presentValueOfFcf: number;
}

export interface BiotechAssetRnpvResult {
  assetId: string;
  presentValueOfCommercialCashFlows: number;
  remainingDevelopmentCostPv: number;
  rnpv: number;
}

export type BiotechRnpvResult = Omit<DCFResults, 'forecasts'> & {
  forecasts: BiotechRnpvForecastYear[];
  wacc: number;
  assetValues: BiotechAssetRnpvResult[];
  otherPipelineRnpv: number;
};

function checkedNumber(value: number, label: string): number {
  if (!Number.isFinite(value)) throw new Error(`${label} must be finite.`);
  return value;
}

function checkedRange(value: number, label: string, minimum: number, maximum: number): number {
  const checked = checkedNumber(value, label);
  if (checked < minimum || checked > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
  return checked;
}

function assetSalesInYear(asset: BiotechAssetRnpvInput, year: number): number {
  if (asset.include === 0 || year < asset.launchYear) return 0;
  const yearsFromLaunch = year - asset.launchYear + 1;
  const ramp = Math.min(1, yearsFromLaunch / asset.yearsToPeak);
  const postLoeFactor = year > asset.exclusivityYear
    ? (1 - asset.postLoeErosion) ** (year - asset.exclusivityYear)
    : 1;
  return asset.peakSales * ramp * postLoeFactor;
}

export function calculateBiotechRnpv(assumptions: BiotechRnpvAssumptions): BiotechRnpvResult {
  const periods = assumptions.commercialRevenueGrowth.length;
  if (periods !== BIOTECH_FORECAST_YEARS) {
    throw new Error(`Biotech rNPV requires ${BIOTECH_FORECAST_YEARS} annual commercial-revenue forecasts.`);
  }
  if (!assumptions.assets.length) throw new Error('Biotech rNPV requires a source-backed asset list.');
  if (assumptions.assets.some((asset) => !asset.assetId.trim())) throw new Error('Each biotech pipeline asset needs a stable identifier.');
  if (new Set(assumptions.assets.map((asset) => asset.assetId)).size !== assumptions.assets.length) {
    throw new Error('Biotech pipeline asset identifiers must be unique.');
  }

  const revenueBase = checkedRange(assumptions.commercialRevenueBase, 'Filed commercial-revenue base', 1, 1e15);
  const commercialMargin = checkedRange(assumptions.commercialFcfMargin, 'Commercial post-tax FCFF margin', -1, 1);
  const otherPipelineRnpv = checkedNumber(assumptions.otherPipelineRnpv, 'Other pipeline rNPV');
  const riskFreeRate = checkedRange(assumptions.riskFreeRate, 'Risk-free rate', 0.001, 0.3);
  const erp = checkedRange(assumptions.equityRiskPremium, 'Equity-risk premium', 0.001, 0.3);
  const beta = checkedRange(assumptions.beta, 'Beta', 0.01, 5);
  const costOfDebt = checkedRange(assumptions.costOfDebt, 'Cost of debt', 0, 0.3);
  const taxRate = checkedRange(assumptions.normalizedTaxRate, 'Normalized tax rate', 0, 0.6);
  const marketCapitalization = checkedRange(assumptions.marketCapitalization, 'Current market capitalization', 1, 1e15);
  const dilutedShares = checkedRange(assumptions.dilutedShares, 'Diluted shares', 1, 1e15);
  const currentPrice = checkedRange(assumptions.currentPrice, 'Current share price', 0.01, 1e6);
  const costOfEquity = riskFreeRate + beta * erp;
  const capital = marketCapitalization + assumptions.debt;
  if (capital <= 0) throw new Error('Biotech market capitalization and debt do not form a valid capital structure.');
  const equityWeight = marketCapitalization / capital;
  const debtWeight = assumptions.debt / capital;
  const wacc = costOfEquity * equityWeight + costOfDebt * (1 - taxRate) * debtWeight;
  const terminalGrowthRate = checkedRange(assumptions.terminalGrowthRate, 'Terminal growth rate', 0, Math.min(0.1, wacc - 0.005));
  const debt = checkedRange(assumptions.debt, 'Interest-bearing debt', 0, 1e15);
  const cash = checkedRange(assumptions.cash, 'Cash', 0, 1e15);
  const marketableSecurities = checkedRange(assumptions.marketableSecurities, 'Marketable securities', 0, 1e15);
  const preferredEquity = checkedRange(assumptions.preferredEquity, 'Preferred equity', 0, 1e15);
  const nonControllingInterest = checkedRange(assumptions.nonControllingInterest, 'Noncontrolling interest', 0, 1e15);
  if (!Number.isFinite(wacc) || wacc < 0.02 || wacc > 0.5) throw new Error('Biotech WACC is outside the supported range.');

  const validatedAssets = assumptions.assets.map((asset) => ({
    ...asset,
    include: checkedRange(asset.include, `${asset.assetId} include flag`, 0, 1),
    launchYear: checkedRange(asset.launchYear, `${asset.assetId} launch year`, assumptions.baseYear + 1, assumptions.baseYear + BIOTECH_FORECAST_YEARS),
    peakSales: checkedRange(asset.peakSales, `${asset.assetId} peak sales`, 0, 1e15),
    yearsToPeak: checkedRange(asset.yearsToPeak, `${asset.assetId} years to peak`, 1, BIOTECH_FORECAST_YEARS),
    exclusivityYear: checkedRange(asset.exclusivityYear, `${asset.assetId} exclusivity year`, assumptions.baseYear + 1, assumptions.baseYear + 30),
    postLoeErosion: checkedRange(asset.postLoeErosion, `${asset.assetId} post-LOE erosion`, 0, 0.99),
    probabilityOfSuccess: checkedRange(asset.probabilityOfSuccess, `${asset.assetId} probability of success`, 0, 1),
    retainedShare: checkedRange(asset.retainedShare, `${asset.assetId} retained share`, 0, 1),
    contributionMargin: checkedRange(asset.contributionMargin, `${asset.assetId} contribution margin`, -1, 1),
    developmentCostPv: checkedRange(asset.developmentCostPv, `${asset.assetId} development-cost PV`, 0, 1e15),
  }));

  const forecasts: BiotechRnpvForecastYear[] = [];
  let commercialRevenue = revenueBase;
  for (let index = 0; index < BIOTECH_FORECAST_YEARS; index += 1) {
    const growth = checkedRange(assumptions.commercialRevenueGrowth[index]!, `FY${assumptions.baseYear + index + 1} commercial revenue growth`, -0.95, 2);
    commercialRevenue *= 1 + growth;
    const commercialFcf = commercialRevenue * commercialMargin;
    const riskAdjustedPipelineFcf = validatedAssets.reduce((sum, asset) => {
      const sales = assetSalesInYear(asset, assumptions.baseYear + index + 1);
      return sum + sales * asset.include * asset.probabilityOfSuccess * asset.retainedShare * asset.contributionMargin;
    }, 0);
    const totalFcf = commercialFcf + riskAdjustedPipelineFcf;
    const discountFactor = 1 / (1 + wacc) ** (index + 1);
    forecasts.push({
      year: assumptions.baseYear + index + 1,
      commercialRevenue,
      commercialFcf,
      riskAdjustedPipelineFcf,
      totalFcf,
      discountFactor,
      presentValueOfFcf: totalFcf * discountFactor,
    });
  }

  const assetValues = validatedAssets.map((asset) => {
    const presentValueOfCommercialCashFlows = Array.from({length: BIOTECH_PIPELINE_FORECAST_YEARS}, (_, index) => {
      const year = assumptions.baseYear + index + 1;
      const sales = assetSalesInYear(asset, year);
      const cashflow = sales * asset.include * asset.probabilityOfSuccess * asset.retainedShare * asset.contributionMargin;
      return cashflow / (1 + wacc) ** (index + 1);
    }).reduce((sum, value) => sum + value, 0);
    const remainingDevelopmentCostPv = asset.include * asset.developmentCostPv;
    return {
      assetId: asset.assetId,
      presentValueOfCommercialCashFlows,
      remainingDevelopmentCostPv,
      rnpv: presentValueOfCommercialCashFlows - remainingDevelopmentCostPv,
    };
  });
  const commercialTerminalValue = forecasts.at(-1)!.commercialFcf * (1 + terminalGrowthRate) / (wacc - terminalGrowthRate);
  const pvCommercialTerminalValue = commercialTerminalValue / (1 + wacc) ** BIOTECH_FORECAST_YEARS;
  const pvForecastCashFlows = forecasts.reduce((sum, forecast) => sum + forecast.presentValueOfFcf, 0);
  const pipelineRnpv = assetValues.reduce((sum, asset) => sum + asset.rnpv, 0) + otherPipelineRnpv;
  const enterpriseValue = pvForecastCashFlows - forecasts.reduce((sum, forecast) => sum + forecast.riskAdjustedPipelineFcf * forecast.discountFactor, 0)
    + pvCommercialTerminalValue + pipelineRnpv;
  const equityValue = enterpriseValue + cash + marketableSecurities - debt - preferredEquity - nonControllingInterest;
  const impliedSharePrice = equityValue / dilutedShares;

  return {
    forecasts,
    wacc,
    assetValues,
    otherPipelineRnpv,
    terminalValue: commercialTerminalValue,
    pvTerminalValue: pvCommercialTerminalValue,
    enterpriseValue,
    equityValue,
    impliedSharePrice,
    shareCount: dilutedShares,
    currentPrice,
    upside: impliedSharePrice / currentPrice - 1,
    terminalValueGordon: commercialTerminalValue,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: false,
    confidenceScore: 0.35,
    confidenceRank: 'Low',
    companyType: 'high_growth',
    preferredModel: 'biotech_pipeline_rnpv',
    isValuationSupported: true,
    isSensitivitySupported: true,
    valuationBasis: 'enterprise',
    modelWarning: 'Risk-adjusted pipeline rNPV plus a consolidated-revenue commercial-franchise DCF. Analyst sales, launch, probability, partner, and cost inputs drive value; pipeline assumptions are not issuer guidance.',
  };
}
