import type {NativeUnifiedPayload} from '@/core/types/native';
import type {IncompleteLifeInsuranceModelExportData} from './types';
import {resolveLifeSourceContract} from '@/services/valuation/life-source-contract.js';

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function buildIncompleteLifeInsuranceModelExportData(
  ticker: string,
  data: NativeUnifiedPayload,
): IncompleteLifeInsuranceModelExportData {
  const normalizedTicker = ticker.toUpperCase();
  if (!normalizedTicker.trim()) {
    throw new Error('Life-insurance payload builder requires an issuer ticker for labeling.');
  }
  const filingFacts = data.financials_native.life_insurance_filing_facts ?? [];
  const contract = resolveLifeSourceContract(filingFacts);
  if (contract === null) {
    throw new Error(`Life-insurance payload for ${normalizedTicker} does not resolve a complete filing-derived source contract.`);
  }
  const earningsMetric = contract.earningsMetric;
  const earningsBasis = contract.earningsBasis;
  const earningsFacts = filingFacts.filter((fact) => fact.metric === earningsMetric && fact.earnings_basis === earningsBasis);
  const baseYear = Math.max(...earningsFacts.map((fact) => fact.fiscal_year));
  if (!Number.isFinite(baseYear) || earningsFacts.length === 0) {
    throw new Error(`Life-insurance payload for ${normalizedTicker} has no source-backed earnings history.`);
  }
  const latestSegments = new Set(earningsFacts.filter((fact) => fact.fiscal_year === baseYear).map((fact) => fact.segment));
  if (latestSegments.size === 0 || latestSegments.has(undefined) || latestSegments.has(null)) {
    throw new Error(`Life-insurance payload for ${normalizedTicker} has no named FY${baseYear} segments.`);
  }
  const latestShares = data.canonical_financials.latest?.shares;
  const filedDilutedShares = (latestShares?.source === 'sec_native' || latestShares?.source === 'derived')
    && isFiniteNumber(latestShares.value) && latestShares.value > 0
    ? latestShares.value
    : null;
  const asOfDate = data.valuation_context.as_of_date ?? new Date().toISOString().slice(0, 10);
  const latestShareSource = latestShares?.sources?.[0];
  const capitalFacts = filingFacts.filter((fact) => fact.metric.includes('rbc')
    || fact.metric.includes('statutory_')
    || fact.metric.includes('dividend'));
  return {
    ticker: normalizedTicker,
    baseYear,
    forecastYears: 5,
    earningsBasis,
    filingFacts,
    riskFreeRate: isFiniteNumber(data.valuation_context.risk_free_rate) ? data.valuation_context.risk_free_rate : null,
    equityRiskPremium: isFiniteNumber(data.valuation_context.equity_risk_premium) ? data.valuation_context.equity_risk_premium : null,
    beta: isFiniteNumber(data.market.beta) ? data.market.beta : null,
    currentPrice: isFiniteNumber(data.market.current_price) ? data.market.current_price : null,
    dilutedShares: filedDilutedShares,
    asOfDate,
    assumptionSources: {
      earningsHistory: `SEC ${normalizedTicker} 10-K adjusted earnings basis: ${earningsBasis}; each segment fact retains accession, year, and table source.`,
      capitalDisclosureScope: capitalFacts.map((fact) => fact.source_statement).filter(Boolean).join(' | '),
      riskFreeRate: `${data.valuation_context.treasury_rate_source || 'Missing current Treasury source'} as of ${asOfDate}`,
      equityRiskPremium: `${data.valuation_context.erp_source || 'Missing current ERP source'} as of ${asOfDate}`,
      beta: `${data.market.source || 'Missing current beta source'} as of ${asOfDate}`,
      currentPrice: `${data.market.source || 'Missing current share-price source'} as of ${asOfDate}`,
      dilutedShares: latestShareSource?.accession
        ? `SEC accession ${latestShareSource.accession}, filed ${latestShareSource.filed}; latest filed diluted share count`
        : 'Missing source-backed diluted share count; enter a dated source on Input Required.',
      parentCashAndClaims: 'Parent-company cash, reserve, debt, and senior claims are separately sourced inputs; consolidated insurer balances are not substituted.',
    },
  };
}
