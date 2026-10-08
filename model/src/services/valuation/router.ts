import type { Assumptions, AssetManagerHistoricalData, BankHistoricalData, DCFResults, EnergyHistoricalData, HistoricalData, InsuranceHistoricalData, ModelEligibility, MortgageReitHistoricalData, Overrides, PharmaHistoricalData, ReitHistoricalData, TelecomHistoricalData } from '@/core/types';
import { isProductionModelRoute } from '@/core/types/native';
import { calculateDCF } from '@/services/dcf/engine';
import { calculateBankValuation, type BankModelAssumptions } from '@/services/valuation/bank-model';
import { calculateInsuranceValuation, type InsuranceModelAssumptions } from '@/services/valuation/insurance-model';
import { calculateReitValuation, type ReitModelAssumptions } from '@/services/valuation/reit-model';
import { calculateAssetManagerValuation, type AssetManagerModelAssumptions } from '@/services/valuation/asset-manager-model';
import { calculateTelecomValuation, type TelecomModelAssumptions } from '@/services/valuation/telecom-model';
import { calculateMortgageReitValuation, type MortgageReitModelAssumptions } from '@/services/valuation/mortgage-reit-model';
import { calculateIntegratedEnergyValuation, type IntegratedEnergyAssumptions } from '@/services/valuation/integrated-energy-model';
import { calculateMaturePharmaValuation, type MaturePharmaModelAssumptions } from '@/services/valuation/mature-pharma-model';
import { calculateComparableValuation, type ComparableValuationInput } from '@/services/valuation/multiple-model';
import { calculateUtilityValuation, type UtilityModelAssumptions } from '@/services/valuation/utility-model';
import { calculateBiotechRnpv, type BiotechRnpvAssumptions } from '@/services/valuation/biotech-rnpv-model';
import { calculateLifeInsuranceDistributableEarnings, type LifeInsuranceDcfAssumptions } from '@/services/valuation/life-insurance-model';
import { mapBiotechForecasts, mapLifeForecasts, mapTelecomForecasts, mapUtilityForecasts } from '@/services/valuation/specialist-forecasts.js';

function safePrice(historicals: HistoricalData): number {
  const price = historicals.price ?? 0;
  return Number.isFinite(price) && price > 0 ? price : 0;
}

function safeShares(historicals: HistoricalData, assumptions: Assumptions): number {
  const shares = assumptions.dilutedSharesOutstanding || historicals.sharesOutstanding || 0;
  return Number.isFinite(shares) && shares > 0 ? shares : 0;
}

function eligibilityWarning(eligibility: ModelEligibility): string {
  return eligibility.blocked_models[0]?.reason || 'This company requires a valuation model that is not implemented yet.';
}

function baseResult(
  historicals: HistoricalData,
  assumptions: Assumptions,
  eligibility: ModelEligibility,
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
    companyType: eligibility.company_type,
    preferredModel: eligibility.preferred_model,
    isValuationSupported: false,
    isSensitivitySupported: false,
  };
}

function unsupportedResult(
  historicals: HistoricalData,
  assumptions: Assumptions,
  eligibility: ModelEligibility,
): DCFResults {
  return baseResult(historicals, assumptions, eligibility, eligibilityWarning(eligibility));
}

export function calculateRoutedValuation(
  historicals: HistoricalData,
  assumptions: Assumptions,
  overrides: Overrides,
  eligibility: ModelEligibility,
  bankModelInput?: {historical: BankHistoricalData; assumptions: BankModelAssumptions},
  insuranceModelInput?: {historical: InsuranceHistoricalData; assumptions: InsuranceModelAssumptions},
  reitModelInput?: {historical: ReitHistoricalData; assumptions: ReitModelAssumptions},
  comparableValuationInput?: ComparableValuationInput,
  assetManagerModelInput?: {historical: AssetManagerHistoricalData; assumptions: AssetManagerModelAssumptions},
  telecomModelInput?: {historical: TelecomHistoricalData; assumptions: TelecomModelAssumptions},
  mortgageReitModelInput?: {historical: MortgageReitHistoricalData; assumptions: MortgageReitModelAssumptions},
  integratedEnergyModelInput?: {historical: EnergyHistoricalData; assumptions: IntegratedEnergyAssumptions},
  maturePharmaModelInput?: {historical: PharmaHistoricalData; assumptions: MaturePharmaModelAssumptions},
  utilityModelInput?: UtilityModelAssumptions,
  biotechModelInput?: BiotechRnpvAssumptions,
  lifeModelInput?: {assumptions: LifeInsuranceDcfAssumptions},
): DCFResults {
  if (eligibility.preferred_model === 'mature_pharma_product_dcf') {
    if (!eligibility.supported_by_current_engine || !isProductionModelRoute(eligibility.preferred_model)
      || !eligibility.allowed_models.includes(eligibility.preferred_model) || !maturePharmaModelInput) {
      return unsupportedResult(historicals, assumptions, eligibility);
    }
    return {
      ...calculateMaturePharmaValuation(maturePharmaModelInput.historical, maturePharmaModelInput.assumptions),
      companyType: eligibility.company_type,
      preferredModel: eligibility.preferred_model,
      isValuationSupported: true,
      isSensitivitySupported: true,
    };
  }

  if (eligibility.preferred_model === 'integrated_energy_dcf') {
    if (!eligibility.supported_by_current_engine || !isProductionModelRoute(eligibility.preferred_model)
      || !eligibility.allowed_models.includes(eligibility.preferred_model) || !integratedEnergyModelInput) {
      return unsupportedResult(historicals, assumptions, eligibility);
    }
    return {
      ...calculateIntegratedEnergyValuation(integratedEnergyModelInput.historical, integratedEnergyModelInput.assumptions),
      companyType: eligibility.company_type,
      preferredModel: eligibility.preferred_model,
      isValuationSupported: true,
      isSensitivitySupported: true,
    };
  }

  if (eligibility.preferred_model === 'mortgage_reit_residual_income') {
    if (!eligibility.supported_by_current_engine || !isProductionModelRoute(eligibility.preferred_model)
      || !eligibility.allowed_models.includes(eligibility.preferred_model) || !mortgageReitModelInput) {
      return unsupportedResult(historicals, assumptions, eligibility);
    }
    return {
      ...calculateMortgageReitValuation(mortgageReitModelInput.historical, mortgageReitModelInput.assumptions),
      companyType: eligibility.company_type,
      preferredModel: eligibility.preferred_model,
      isValuationSupported: true,
      isSensitivitySupported: true,
    };
  }

  if (
    !eligibility.supported_by_current_engine
    || !isProductionModelRoute(eligibility.preferred_model)
    || !eligibility.allowed_models.includes(eligibility.preferred_model)
  ) {
    return unsupportedResult(historicals, assumptions, eligibility);
  }

  switch (eligibility.preferred_model) {
    case 'bank_residual_income': {
      if (!bankModelInput) return unsupportedResult(historicals, assumptions, eligibility);
      return {
        ...calculateBankValuation(bankModelInput.historical, bankModelInput.assumptions),
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: true,
        isSensitivitySupported: false,
      };
    }
    case 'insurance_pnc_residual_income': {
      if (!insuranceModelInput) return unsupportedResult(historicals, assumptions, eligibility);
      return {
        ...calculateInsuranceValuation(insuranceModelInput.historical, insuranceModelInput.assumptions),
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: true,
        isSensitivitySupported: false,
      };
    }
    case 'reit_affo': {
      if (!reitModelInput) return unsupportedResult(historicals, assumptions, eligibility);
      return {
        ...calculateReitValuation(reitModelInput.historical, reitModelInput.assumptions),
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: true,
        isSensitivitySupported: true,
      };
    }
    case 'asset_manager_aum_dcf': {
      if (!assetManagerModelInput) return unsupportedResult(historicals, assumptions, eligibility);
      return {
        ...calculateAssetManagerValuation(assetManagerModelInput.historical, assetManagerModelInput.assumptions),
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: true,
        isSensitivitySupported: true,
      };
    }
    case 'telecom_subscriber_dcf': {
      if (!telecomModelInput) return unsupportedResult(historicals, assumptions, eligibility);
      const telecomResult = calculateTelecomValuation(telecomModelInput.historical, telecomModelInput.assumptions);
      const telecomForecasts = mapTelecomForecasts(telecomResult.telecomForecasts);
      const telecomSupported = telecomForecasts.length > 0;
      return {
        ...telecomResult,
        forecasts: telecomForecasts,
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: telecomSupported,
        isSensitivitySupported: telecomSupported,
      };
    }
    case 'ev_ebitda':
    case 'revenue_multiple': {
      if (!comparableValuationInput || comparableValuationInput.method !== eligibility.preferred_model) {
        return unsupportedResult(historicals, assumptions, eligibility);
      }
      return {
        ...calculateComparableValuation(comparableValuationInput),
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: true,
        isSensitivitySupported: true,
      };
    }
    case 'unlevered_dcf': {
      const result = calculateDCF(historicals, assumptions, overrides);
      const hasForecast = result.forecasts.length > 0;
      return {
        ...result,
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: hasForecast,
        isSensitivitySupported: hasForecast,
      };
    }
    case 'utility_dcf': {
      if (!utilityModelInput) return unsupportedResult(historicals, assumptions, eligibility);
      const utilityResult = calculateUtilityValuation(utilityModelInput);
      const utilityForecasts = mapUtilityForecasts(utilityResult.forecasts);
      const utilitySupported = utilityForecasts.length > 0;
      return {
        ...utilityResult,
        forecasts: utilityForecasts,
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: utilitySupported,
        isSensitivitySupported: utilitySupported,
      };
    }
    case 'biotech_pipeline_rnpv': {
      if (!biotechModelInput) return unsupportedResult(historicals, assumptions, eligibility);
      const biotechResult = calculateBiotechRnpv(biotechModelInput);
      const biotechForecasts = mapBiotechForecasts(biotechResult.forecasts);
      const biotechSupported = biotechForecasts.length > 0;
      return {
        ...biotechResult,
        forecasts: biotechForecasts,
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: biotechSupported,
        isSensitivitySupported: biotechSupported,
      };
    }
    case 'life_insurer_distributable_earnings_dcf': {
      if (!lifeModelInput) return unsupportedResult(historicals, assumptions, eligibility);
      const lifeResult = calculateLifeInsuranceDistributableEarnings(lifeModelInput.assumptions);
      const lifeForecasts = mapLifeForecasts(lifeResult.lifeInsuranceForecasts);
      const lifeSupported = lifeForecasts.length > 0;
      return {
        ...lifeResult,
        forecasts: lifeForecasts,
        companyType: eligibility.company_type,
        preferredModel: eligibility.preferred_model,
        isValuationSupported: lifeSupported,
        isSensitivitySupported: lifeSupported,
      };
    }
    default:
      return unsupportedResult(historicals, assumptions, eligibility);
  }
}
