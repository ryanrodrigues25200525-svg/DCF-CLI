import type {LifeInsuranceFilingFact} from '@/core/types/native';

export interface LifeSourceContract {
  earningsBasis: 'after_tax_adjusted_earnings_available_to_common' | 'pre_tax_adjusted_operating_income';
  earningsMetric: 'adjusted_earnings_available_to_common' | 'adjusted_operating_income_pretax';
  segmentNames: string[];
  capitalMetric: string;
  dividendCapacityGroup: string;
  requiresNormalizedTax: boolean;
}

const KNOWN_EARNINGS = [
  {metric: 'adjusted_earnings_available_to_common', basis: 'after_tax_adjusted_earnings_available_to_common'},
  {metric: 'adjusted_operating_income_pretax', basis: 'pre_tax_adjusted_operating_income'},
] as const;

const CAPITAL_METRICS = [
  'statement_based_combined_rbc_ratio_floor',
  'naic_based_combined_rbc_ratio_floor',
  'statutory_capital_and_surplus',
  'statutory_net_income',
  'rbc_minimum_regulatory_threshold_floor',
];

export function resolveLifeSourceContract(facts: LifeInsuranceFilingFact[]): LifeSourceContract | null {
  const rows = Array.isArray(facts) ? facts : [];
  if (rows.length === 0) return null;
  for (const {metric, basis} of KNOWN_EARNINGS) {
    const annual = rows.filter((fact) => fact.metric === metric);
    if (annual.length === 0) continue;
    const years = [...new Set(annual.filter((fact) => Number.isInteger(fact.fiscal_year)).map((fact) => fact.fiscal_year))].sort((a, b) => a - b);
    if (years.length < 3) continue;
    const tail = years.slice(-3);
    if (tail[2] === undefined || tail[0] === undefined || tail[0] !== tail[2] - 2 || tail[1] !== tail[2] - 1) continue;
    const baseYear = tail[2];
    const baseRows = annual.filter((fact) => fact.fiscal_year === baseYear);
    const segments = [...new Set(baseRows.map((fact) => fact.segment).filter((segment): segment is string => Boolean(segment)))].sort();
    if (segments.length === 0 || segments.length !== baseRows.length) continue;
    if (baseRows.some((fact) => fact.unit !== 'USD' || fact.unit_scale !== 'millions' || fact.earnings_basis !== basis)) continue;
    let complete = true;
    for (const year of tail) {
      const yearSegments = new Set(annual.filter((fact) => fact.fiscal_year === year).map((fact) => fact.segment));
      if (yearSegments.size !== segments.length || segments.some((segment) => !yearSegments.has(segment))) { complete = false; break; }
    }
    if (!complete) continue;
    const capitalMetric = CAPITAL_METRICS.find((candidate) => rows.some((fact) => fact.metric === candidate && fact.fiscal_year === baseYear));
    const dividendRows = rows.filter((fact) => fact.metric === 'permitted_ordinary_dividend_without_approval'
      && fact.fiscal_year === baseYear + 1 && fact.capital_group);
    if (!capitalMetric || dividendRows.length === 0) continue;
    return {
      earningsBasis: basis,
      earningsMetric: metric,
      segmentNames: segments,
      capitalMetric,
      dividendCapacityGroup: String(dividendRows[0]?.capital_group),
      requiresNormalizedTax: basis === 'pre_tax_adjusted_operating_income',
    };
  }
  return null;
}
