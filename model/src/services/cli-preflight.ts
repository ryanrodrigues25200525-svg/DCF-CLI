import type {WorkbookInputRequirement} from '@/services/exporters/excel/types';

export function getRevenueHistoryError(
  ticker: string,
  years: readonly number[],
  revenue: readonly (number | null)[],
): string | null {
  if (years.length === 0) {
    return `No annual financial history was returned for ${ticker}.`;
  }
  if (revenue.some((value) => value !== null && Number.isFinite(value) && value > 0)) {
    return null;
  }

  const period = `${years[0]}–${years[years.length - 1]}`;
  return `No positive revenue was returned for ${ticker} in SEC annual periods ${period}. The current DCF requires at least one positive historical revenue year; no workbook was created.`;
}

export function getAnnualHistoryDisclosure(years: readonly number[]): string | null {
  const latestYear = years[years.length - 1];
  if (!latestYear) return null;
  return `Financial statements are annual through FY${latestYear}; interim filings are not included. Review current-year forecasts against the latest SEC quarterly results.`;
}

export function formatCliSuccess(companyName: string, ticker: string, outputPath: string): string {
  return `${companyName} (${ticker})\nWorkbook: ${outputPath}`;
}

export function formatCliInputRequiredSuccess(
  companyName: string,
  ticker: string,
  outputPath: string,
  requiredInputs: readonly WorkbookInputRequirement[],
): string {
  const gaps = requiredInputs.map((input) => `- ${input.label}${input.fiscalYear ? ` FY${input.fiscalYear}` : ''}: ${input.reason}`);
  return [
    `${companyName} (${ticker})`,
    `Workbook: ${outputPath}`,
    'Status: INCOMPLETE — no valuation was calculated.',
    'Required inputs:',
    ...gaps,
  ].join('\n');
}
