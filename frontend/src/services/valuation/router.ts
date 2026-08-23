import type { Assumptions, CompanyProfile, DCFResults, HistoricalData, NativeUnifiedPayload, Overrides } from '@/core/types';
import { calculateDCF } from '@/services/dcf/engine';
import { classifyCompany } from './company-classifier';

function safePrice(historicals: HistoricalData): number {
  const price = historicals.price ?? 0;
  return Number.isFinite(price) && price > 0 ? price : 0;
}

function safeShares(historicals: HistoricalData, assumptions: Assumptions): number {
  const shares = assumptions.dilutedSharesOutstanding || historicals.sharesOutstanding || 0;
  return Number.isFinite(shares) && shares > 0 ? shares : 0;
}

function latest(values: number[] | undefined): number {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const value = values[values.length - 1];
  return Number.isFinite(value) ? value : 0;
}

function costOfEquity(assumptions: Assumptions, historicals: HistoricalData): number {
  const rf = assumptions.riskFreeRate ?? 0.045;
  const erp = assumptions.equityRiskPremium ?? 0.05;
  const beta = assumptions.beta ?? historicals.beta ?? 1;
  return Math.max(0.06, Math.min(0.18, rf + beta * erp));
}

function baseResult(
  historicals: HistoricalData,
  assumptions: Assumptions,
  classification: ReturnType<typeof classifyCompany>,
  warning: string,
): DCFResults {
  const currentPrice = safePrice(historicals);
  const shareCount = safeShares(historicals, assumptions);
  const marketCap = currentPrice > 0 && shareCount > 0 ? currentPrice * shareCount : 0;

  return {
    forecasts: [],
    terminalValue: 0,
    pvTerminalValue: 0,
    enterpriseValue: 0,
    equityValue: marketCap,
    impliedSharePrice: 0,
    shareCount,
    currentPrice,
    upside: 0,
    terminalValueGordon: 0,
    terminalValueExitMultiple: 0,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: false,
    confidenceScore: 0,
    confidenceRank: 'Low',
    sectorWarning: warning,
    modelWarning: warning,
    companyType: classification.companyType,
    preferredModel: classification.preferredModel,
    isValuationSupported: false,
    isSensitivitySupported: false,
  };
}

function unsupportedResult(
  historicals: HistoricalData,
  assumptions: Assumptions,
  classification: ReturnType<typeof classifyCompany>,
): DCFResults {
  const warning = classification.reason || 'This company requires a valuation model that is not implemented yet.';
  return baseResult(historicals, assumptions, classification, warning);
}

function residualIncomeValuation(
  historicals: HistoricalData,
  assumptions: Assumptions,
  classification: ReturnType<typeof classifyCompany>,
): DCFResults {
  const warning = `${classification.reason || 'Residual income model selected.'} Lightweight residual-income estimate; use as directional until full sector model is implemented.`;
  const result = baseResult(historicals, assumptions, classification, warning);
  const shares = Math.max(result.shareCount, 1);
  const bookValue = Math.max(latest(historicals.shareholdersEquity), 0);
  const netIncome = latest(historicals.netIncome);
  const coe = costOfEquity(assumptions, historicals);
  const terminalGrowth = Math.min(assumptions.terminalGrowthRate ?? 0.025, coe - 0.01);
  const roe = bookValue > 0 ? netIncome / bookValue : 0;
  const sustainableRoe = Math.max(0.04, Math.min(0.20, roe || coe + 0.01));
  const payout = Math.max(0.2, Math.min(0.7, assumptions.dividendPayoutRatio ?? 0.35));
  const retention = 1 - payout;

  let currentBook = bookValue;
  let pvResidualIncome = 0;
  let lastResidualIncome = 0;

  for (let year = 1; year <= 5; year += 1) {
    const forecastIncome = currentBook * sustainableRoe;
    const residualIncome = forecastIncome - (coe * currentBook);
    pvResidualIncome += residualIncome / Math.pow(1 + coe, year);
    currentBook += forecastIncome * retention;
    lastResidualIncome = residualIncome;
  }

  const terminalResidualIncome = (lastResidualIncome * (1 + terminalGrowth)) / Math.max(0.01, coe - terminalGrowth);
  const equityValue = Math.max(0, bookValue + pvResidualIncome + terminalResidualIncome / Math.pow(1 + coe, 5));

  return {
    ...result,
    equityValue,
    enterpriseValue: equityValue,
    impliedSharePrice: equityValue / shares,
    upside: result.currentPrice > 0 ? (equityValue / shares - result.currentPrice) / result.currentPrice : 0,
    terminalValue: terminalResidualIncome,
    pvTerminalValue: terminalResidualIncome / Math.pow(1 + coe, 5),
    confidenceScore: bookValue > 0 && netIncome > 0 ? 0.55 : 0.25,
    confidenceRank: bookValue > 0 && netIncome > 0 ? 'Medium' : 'Low',
    avgROIC: sustainableRoe,
    isValuationSupported: true,
    isSensitivitySupported: false,
  };
}

function reitAffoValuation(
  historicals: HistoricalData,
  assumptions: Assumptions,
  classification: ReturnType<typeof classifyCompany>,
): DCFResults {
  const warning = `${classification.reason || 'REIT AFFO model selected.'} Lightweight AFFO multiple estimate; use as directional until full REIT model is implemented.`;
  const result = baseResult(historicals, assumptions, classification, warning);
  const shares = Math.max(result.shareCount, 1);
  const revenue = latest(historicals.revenue);
  const netIncome = latest(historicals.netIncome);
  const depreciation = Math.max(latest(historicals.depreciation), revenue * 0.08);
  const capex = latest(historicals.capex) > 0 ? latest(historicals.capex) : revenue * 0.04;
  const affo = Math.max(0, netIncome + depreciation - capex);
  const multiple = Math.max(10, Math.min(24, assumptions.terminalExitMultiple || 16));
  const equityValue = affo * multiple;

  return {
    ...result,
    equityValue,
    enterpriseValue: equityValue + latest(historicals.totalDebt) - latest(historicals.cash),
    impliedSharePrice: equityValue / shares,
    upside: result.currentPrice > 0 ? (equityValue / shares - result.currentPrice) / result.currentPrice : 0,
    terminalValue: equityValue,
    pvTerminalValue: equityValue,
    confidenceScore: affo > 0 ? 0.5 : 0.2,
    confidenceRank: affo > 0 ? 'Medium' : 'Low',
    isValuationSupported: true,
    isSensitivitySupported: false,
  };
}

function utilityDividendValuation(
  historicals: HistoricalData,
  assumptions: Assumptions,
  classification: ReturnType<typeof classifyCompany>,
): DCFResults {
  const warning = `${classification.reason || 'Utility dividend model selected.'} Lightweight dividend/cost-of-equity estimate; use as directional until full regulated utility model is implemented.`;
  const result = baseResult(historicals, assumptions, classification, warning);
  const shares = Math.max(result.shareCount, 1);
  const netIncome = Math.max(0, latest(historicals.netIncome));
  const dividends = Math.abs(latest(historicals.dividendsPaid)) || netIncome * 0.65;
  const coe = costOfEquity(assumptions, historicals);
  const growth = Math.min(0.035, Math.max(0.01, assumptions.terminalGrowthRate ?? 0.025));
  const equityValue = dividends > 0 ? (dividends * (1 + growth)) / Math.max(0.01, coe - growth) : 0;

  return {
    ...result,
    equityValue,
    enterpriseValue: equityValue + latest(historicals.totalDebt) - latest(historicals.cash),
    impliedSharePrice: equityValue / shares,
    upside: result.currentPrice > 0 ? (equityValue / shares - result.currentPrice) / result.currentPrice : 0,
    terminalValue: equityValue,
    pvTerminalValue: equityValue,
    confidenceScore: dividends > 0 ? 0.45 : 0.2,
    confidenceRank: dividends > 0 ? 'Medium' : 'Low',
    isValuationSupported: true,
    isSensitivitySupported: false,
  };
}

export function calculateRoutedValuation(
  historicals: HistoricalData,
  assumptions: Assumptions,
  overrides: Overrides,
  profile?: CompanyProfile | null,
  backendEligibility?: NativeUnifiedPayload["model_eligibility"],
): DCFResults {
  const localClassification = classifyCompany(profile, historicals);
  const classification = backendEligibility?.company_type && backendEligibility?.preferred_model
    ? {
      ...localClassification,
      companyType: backendEligibility.company_type as typeof localClassification.companyType,
      preferredModel: backendEligibility.preferred_model as typeof localClassification.preferredModel,
      supportedByCurrentEngine: backendEligibility.supported_by_current_engine ?? localClassification.supportedByCurrentEngine,
      reason: backendEligibility.blocked_models?.[0]?.reason || localClassification.reason,
    }
    : localClassification;

  if (!classification.supportedByCurrentEngine) {
    if (classification.companyType === 'bank' || classification.companyType === 'insurance') {
      return residualIncomeValuation(historicals, assumptions, classification);
    }
    if (classification.companyType === 'reit') {
      return reitAffoValuation(historicals, assumptions, classification);
    }
    if (classification.companyType === 'utility') {
      return utilityDividendValuation(historicals, assumptions, classification);
    }
    return unsupportedResult(historicals, assumptions, classification);
  }

  const result = calculateDCF(historicals, assumptions, overrides);
  const warnings = [
    result.sectorWarning,
    classification.reason,
  ].filter(Boolean).join(' ');

  return {
    ...result,
    sectorWarning: warnings || result.sectorWarning,
    modelWarning: classification.reason,
    companyType: classification.companyType,
    preferredModel: classification.preferredModel,
    isValuationSupported: true,
    isSensitivitySupported: true,
  };
}
