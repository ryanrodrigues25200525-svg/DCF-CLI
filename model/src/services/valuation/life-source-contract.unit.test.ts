import { describe, expect, it } from 'vitest';
import type { LifeInsuranceFilingFact } from '@/core/types/native';
import { resolveLifeSourceContract } from '@/services/valuation/life-source-contract.js';

function fact(overrides: Partial<LifeInsuranceFilingFact> & { metric: string }): LifeInsuranceFilingFact {
  return {
    segment: null,
    capital_group: null,
    value: 100,
    unit: 'USD',
    unit_scale: 'millions',
    fiscal_year: 2025,
    fiscal_period: 'FY',
    accession_number: '0000000000-25-000001',
    filing_date: '2026-02-20',
    form: '10-K',
    report_date: '2025-12-31',
    primary_document: 'tst-2025x10k.htm',
    source_statement: 'synthetic third insurer',
    earnings_basis: 'after_tax_adjusted_earnings_available_to_common',
    ...overrides,
  };
}

/** Synthetic third insurer (ticker TST): same schedule shape, no "supports only" throw. */
function thirdInsurerFacts(): LifeInsuranceFilingFact[] {
  const facts: LifeInsuranceFilingFact[] = [];
  for (const year of [2023, 2024, 2025]) {
    for (const segment of ['Annuities', 'Protection', 'Corporate']) {
      facts.push(fact({ metric: 'adjusted_earnings_available_to_common', segment, fiscal_year: year }));
    }
  }
  facts.push(fact({
    metric: 'statutory_capital_and_surplus',
    capital_group: 'TST Life Insurance Co',
    earnings_basis: 'not_applicable',
  }));
  facts.push(fact({
    metric: 'permitted_ordinary_dividend_without_approval',
    capital_group: 'TST Life Insurance Co',
    fiscal_year: 2026,
    earnings_basis: 'not_applicable',
  }));
  return facts;
}

describe('resolveLifeSourceContract (ticker-agnostic)', () => {
  it('resolves a contract for a synthetic third insurer', () => {
    const contract = resolveLifeSourceContract(thirdInsurerFacts());
    expect(contract).not.toBeNull();
    expect(contract?.earningsMetric).toBe('adjusted_earnings_available_to_common');
    expect(contract?.earningsBasis).toBe('after_tax_adjusted_earnings_available_to_common');
    expect(contract?.segmentNames).toEqual(['Annuities', 'Corporate', 'Protection']);
    expect(contract?.requiresNormalizedTax).toBe(false);
  });

  it('returns null for incomplete facts', () => {
    expect(resolveLifeSourceContract([])).toBeNull();
    expect(resolveLifeSourceContract([fact({ metric: 'adjusted_earnings_available_to_common', segment: 'Solo' })])).toBeNull();
  });
});
