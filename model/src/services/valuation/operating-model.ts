import type { Assumptions, HistoricalData } from '@/core/types';
import type { CanonicalFinancialLine, OperatingArchetype } from '@/core/types/native';

type CoreOperatingArchetype = Extract<
  OperatingArchetype,
  | 'standard_operating'
  | 'technology_hardware'
  | 'subscription_software'
  | 'consumer_retail'
  | 'industrial_manufacturing'
  | 'semiconductor'
>;

interface OperatingModelPolicy {
  label: string;
  baseEbitMargin: 'latest' | 'three_year_average';
  workingCapital: 'filed_operating_days' | 'aggregate_balance_sheet_residual';
}

export interface OperatingModelProfile {
  assumptionOverrides: Partial<Assumptions>;
  sourceNotes: string[];
}

const OPERATING_POLICIES: Record<CoreOperatingArchetype, OperatingModelPolicy> = {
  standard_operating: {
    label: 'Standard operating',
    baseEbitMargin: 'three_year_average',
    workingCapital: 'filed_operating_days',
  },
  technology_hardware: {
    label: 'Technology hardware',
    baseEbitMargin: 'latest',
    workingCapital: 'filed_operating_days',
  },
  subscription_software: {
    label: 'Subscription software',
    baseEbitMargin: 'latest',
    workingCapital: 'aggregate_balance_sheet_residual',
  },
  consumer_retail: {
    label: 'Consumer retail',
    baseEbitMargin: 'three_year_average',
    workingCapital: 'filed_operating_days',
  },
  industrial_manufacturing: {
    label: 'Industrial manufacturing',
    baseEbitMargin: 'latest',
    workingCapital: 'filed_operating_days',
  },
  semiconductor: {
    label: 'Semiconductor',
    baseEbitMargin: 'latest',
    workingCapital: 'filed_operating_days',
  },
};

function filedLine(
  historicals: HistoricalData,
  field: string,
  index: number,
): CanonicalFinancialLine {
  const line = historicals.sourceData?.[field]?.[index];
  if (!line || !['sec_native', 'derived'].includes(line.source)
    || typeof line.value !== 'number' || !Number.isFinite(line.value)
    || line.sources.length === 0
    || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${historicals.years[index]} operating-profile input ${field} must have a filed SEC value and provenance.`);
  }
  return line;
}

function average(values: number[], label: string): number {
  if (values.length !== 3 || values.some((value) => !Number.isFinite(value))) {
    throw new Error(`The ${label} operating-profile average requires three filed annual observations.`);
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function coreArchetype(value: OperatingArchetype | null | undefined): CoreOperatingArchetype {
  if (!value || !(value in OPERATING_POLICIES)) {
    throw new Error('The production operating DCF requires a registered core operating archetype.');
  }
  return value as CoreOperatingArchetype;
}

export function buildOperatingModelProfile(
  archetypeValue: OperatingArchetype | null | undefined,
  historicals: HistoricalData,
  base: Assumptions,
  options: {allowMissingCapex?: boolean} = {},
): OperatingModelProfile {
  const archetype = coreArchetype(archetypeValue);
  const policy = OPERATING_POLICIES[archetype];
  const firstIndex = historicals.years.length - 3;
  if (firstIndex < 0) {
    throw new Error('The operating DCF requires three filed years to establish its driver profile.');
  }

  const observations = [firstIndex, firstIndex + 1, firstIndex + 2].map((index) => {
    const revenue = filedLine(historicals, 'revenue', index).value!;
    if (revenue <= 0) throw new Error(`FY${historicals.years[index]} revenue must be positive for the operating profile.`);
    const ebit = filedLine(historicals, 'ebit', index).value!;
    const grossProfit = filedLine(historicals, 'gross_profit', index).value!;
    const capexLine = historicals.sourceData?.capex?.[index];
    const capexReady = Boolean(capexLine
      && ['sec_native', 'derived'].includes(capexLine.source)
      && typeof capexLine.value === 'number'
      && Number.isFinite(capexLine.value)
      && capexLine.sources.length > 0
      && capexLine.sources.every((source) => source.accession && source.filed));
    if (!capexReady && !options.allowMissingCapex) {
      throw new Error(`FY${historicals.years[index]} operating-profile input capex must have a filed SEC value and provenance.`);
    }
    const depreciation = Math.abs(filedLine(historicals, 'depreciation', index).value!);
    return {
      year: historicals.years[index],
      revenue,
      ebitMargin: ebit / revenue,
      grossMargin: grossProfit / revenue,
      capexRatio: capexReady ? Math.abs(capexLine!.value!) / revenue : null,
      depreciationRatio: depreciation / revenue,
    };
  });
  const latestIndex = historicals.years.length - 1;
  const latestRevenue = filedLine(historicals, 'revenue', latestIndex).value!;
  const latestEbit = filedLine(historicals, 'ebit', latestIndex).value!;
  const threeYearEbitMargin = average(observations.map((item) => item.ebitMargin), 'EBIT-margin');
  const threeYearGrossMargin = average(observations.map((item) => item.grossMargin), 'gross-margin');
  const filedCapexRatios = observations.flatMap((item) => item.capexRatio === null ? [] : [item.capexRatio]);
  const threeYearCapexRatio = filedCapexRatios.length === 3
    ? average(filedCapexRatios, 'CapEx')
    : null;
  const threeYearDepreciationRatio = average(observations.map((item) => item.depreciationRatio), 'D&A');
  const latestEbitMargin = latestEbit / latestRevenue;
  const baseEbitMargin = policy.baseEbitMargin === 'three_year_average'
    ? threeYearEbitMargin
    : latestEbitMargin;

  if (![baseEbitMargin, threeYearEbitMargin, threeYearGrossMargin].every((value) => Number.isFinite(value) && value > 0 && value <= 1)
    || (threeYearCapexRatio !== null && (!Number.isFinite(threeYearCapexRatio) || threeYearCapexRatio < 0 || threeYearCapexRatio > 1))
    || !Number.isFinite(threeYearDepreciationRatio) || threeYearDepreciationRatio < 0 || threeYearDepreciationRatio > 1) {
    throw new Error(`The ${policy.label.toLowerCase()} three-year filed operating profile is outside supported driver ranges.`);
  }
  if (threeYearCapexRatio === null && !options.allowMissingCapex) {
    throw new Error(`The ${policy.label.toLowerCase()} model requires three filed CapEx years.`);
  }

  const years = observations.map((item) => item.year).join(', ');
  const growthRate = base.revenueGrowth;
  const capexSourceNote = threeYearCapexRatio === null
    ? 'The CapEx forecast ratio remains formula-linked to the required filed historical CapEx inputs and has no displayed value until those inputs are supplied.'
    : `CapEx ratio uses the three-year filed average ${(threeYearCapexRatio * 100).toFixed(2)}%.`;
  const sourceNotes = [
    `${policy.label} five-year profile: Revenue growth is initialized from the filed revenue history (5-year CAGR ${(growthRate * 100).toFixed(2)}%), not issuer guidance. Stage 1 growth applies for three years, then fades linearly toward Stage 2 growth over four years; terminal growth is separate. Forecast gross margin uses the three-year filed average for FY${years}. EBIT margin starts at ${policy.baseEbitMargin === 'latest' ? `latest filed FY${historicals.years[latestIndex]} margin ${(latestEbitMargin * 100).toFixed(2)}%` : `three-year filed average ${(threeYearEbitMargin * 100).toFixed(2)}%`} and fades linearly over five years to the three-year filed average ${(threeYearEbitMargin * 100).toFixed(2)}%. ${capexSourceNote} D&A ratio uses the three-year filed average ${(threeYearDepreciationRatio * 100).toFixed(2)}%. The assumption cells remain editable.`,
    `Working-capital policy for ${policy.label.toLowerCase()}: ${policy.workingCapital === 'aggregate_balance_sheet_residual' ? 'filed aggregate operating working capital plus an editable residual-to-revenue driver' : 'filed receivable, inventory, and payable days'}.`,
  ];

  return {
    assumptionOverrides: {
      revenueGrowthStage1: growthRate,
      revenueGrowthStage2: growthRate * 0.6,
      revenueGrowthStage1Years: 3,
      revenueGrowthFadeYears: 4,
      advancedMode: true,
      ebitMargin: baseEbitMargin,
      ebitMarginSteadyState: threeYearEbitMargin,
      ebitMarginConvergenceYears: 5,
      grossMargin: threeYearGrossMargin,
      ...(threeYearCapexRatio === null ? {} : {capexRatio: threeYearCapexRatio}),
      deaRatio: threeYearDepreciationRatio,
    },
    sourceNotes,
  };
}
