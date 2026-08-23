import type { CompanyProfile, HistoricalData } from '@/core/types';

export type CompanyType =
  | 'operating'
  | 'bank'
  | 'insurance'
  | 'reit'
  | 'utility'
  | 'high_growth'
  | 'distressed';

export type PreferredValuationModel =
  | 'unlevered_dcf'
  | 'levered_dcf'
  | 'ddm'
  | 'residual_income'
  | 'reit_affo'
  | 'utility_dcf'
  | 'revenue_multiple'
  | 'ev_ebitda';

export interface CompanyClassification {
  companyType: CompanyType;
  preferredModel: PreferredValuationModel;
  supportedByCurrentEngine: boolean;
  reason?: string;
}

function normalizedText(...parts: Array<string | undefined | null>): string {
  return parts.filter(Boolean).join(' ').toLowerCase();
}

function latest(values: number[] | undefined): number {
  if (!Array.isArray(values) || values.length === 0) return 0;
  const value = values[values.length - 1];
  return Number.isFinite(value) ? value : 0;
}

export function classifyCompany(
  profile: Pick<CompanyProfile, 'ticker' | 'sector' | 'industry'> | null | undefined,
  historicals: HistoricalData | null | undefined,
): CompanyClassification {
  const ticker = profile?.ticker?.toUpperCase() || '';
  const text = normalizedText(profile?.sector, profile?.industry);
  const latestRevenue = latest(historicals?.revenue);
  const latestEbit = latest(historicals?.ebit);
  const latestDebt = latest(historicals?.totalDebt);
  const latestEquity = latest(historicals?.shareholdersEquity);

  if (/\b(bank|banks|depository|commercial banks|credit services|savings institution)\b/.test(text)) {
    return {
      companyType: 'bank',
      preferredModel: 'residual_income',
      supportedByCurrentEngine: false,
      reason: 'Bank detected. Standard enterprise-value FCFF DCF treats debt incorrectly for banks; use residual income or P/TBV.',
    };
  }

  if (/\b(insurance|reinsurance|property casualty|life insurance|casualty insurance)\b/.test(text)) {
    return {
      companyType: 'insurance',
      preferredModel: 'residual_income',
      supportedByCurrentEngine: false,
      reason: 'Insurance company detected. Book value and ROE-based valuation are more appropriate than unlevered FCFF.',
    };
  }

  if (/\b(reit|real estate investment trust|real estate investment trusts)\b/.test(text)) {
    return {
      companyType: 'reit',
      preferredModel: 'reit_affo',
      supportedByCurrentEngine: false,
      reason: 'REIT detected. Use FFO/AFFO, NAV, cap rates, and dividend support instead of standard FCFF.',
    };
  }

  if (/\b(electric|utility|utilities|gas utility|water utility|regulated)\b/.test(text)) {
    return {
      companyType: 'utility',
      preferredModel: 'utility_dcf',
      supportedByCurrentEngine: false,
      reason: 'Utility detected. Use a regulated, capex-heavy utility DCF rather than the generic operating-company model.',
    };
  }

  const debtToEquity = latestEquity > 0 ? latestDebt / latestEquity : 0;
  if (latestRevenue > 0 && latestEbit <= 0) {
    return {
      companyType: debtToEquity > 3 ? 'distressed' : 'high_growth',
      preferredModel: debtToEquity > 3 ? 'ev_ebitda' : 'revenue_multiple',
      supportedByCurrentEngine: true,
      reason: 'Profitability is weak or negative. Use staged margin convergence and compare against revenue or EBITDA multiples.',
    };
  }

  if (ticker === 'BRK.A' || ticker === 'BRK-B' || ticker === 'BRK.B') {
    return {
      companyType: 'insurance',
      preferredModel: 'residual_income',
      supportedByCurrentEngine: false,
      reason: 'Insurance/holding company detected. Book value and look-through earnings are more appropriate than generic FCFF.',
    };
  }

  return {
    companyType: 'operating',
    preferredModel: 'unlevered_dcf',
    supportedByCurrentEngine: true,
  };
}
