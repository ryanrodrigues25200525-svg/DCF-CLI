import { describe, expect, it } from 'vitest';
import { biotechPayload } from '@/services/valuation/specialist-test-fixtures.js';
import {
  buildSourcedBiotechRnpvAssumptions,
  buildSourcedLifeInsuranceAssumptions,
  buildSourcedUtilityModelAssumptions,
} from '@/services/valuation/specialist-ready-assumptions.js';

describe('specialist ready assumption builders (#43)', () => {
  it('utility builder names the missing filed rate-base facts', () => {
    const data = biotechPayload(100_000_000);
    expect(() => buildSourcedUtilityModelAssumptions(data)).toThrow(/rate-base/i);
  });

  it('biotech builder with filed base and inventory names analyst economics, not filed facts', () => {
    const data = biotechPayload(100_000_000);
    try {
      buildSourcedBiotechRnpvAssumptions(data);
      expect.unreachable('builder should throw until analyst pipeline economics are filed');
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toMatch(/pipeline asset economics|commercial-franchise/i);
      expect(message).not.toMatch(/commercial-revenue base|pipeline asset inventory/i);
    }
  });

  it('biotech builder reports a missing base instead of the pre-revenue path when revenue is unknown', () => {
    const data = biotechPayload(null);
    expect(() => buildSourcedBiotechRnpvAssumptions(data)).toThrow(/commercial-revenue base/i);
  });

  it('life builder names the missing analyst schedules once the source contract resolves', () => {    const data = biotechPayload(100_000_000);
    const facts = [];
    for (const year of [2023, 2024, 2025]) {
      for (const segment of ['Annuities', 'Protection', 'Corporate']) {
        facts.push({
          metric: 'adjusted_earnings_available_to_common',
          segment,
          capital_group: null,
          value: 100,
          unit: 'USD',
          unit_scale: 'millions',
          fiscal_year: year,
          fiscal_period: 'FY',
          accession_number: '0000000000-25-000001',
          filing_date: '2026-02-20',
          form: '10-K',
          report_date: '2025-12-31',
          primary_document: 'tst-2025x10k.htm',
          source_statement: 'synthetic third insurer',
          earnings_basis: 'after_tax_adjusted_earnings_available_to_common',
        });
      }
    }
    facts.push({
      metric: 'statutory_capital_and_surplus',
      segment: null,
      capital_group: 'TST Life Insurance Co',
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
      earnings_basis: 'not_applicable',
    });
    facts.push({
      metric: 'permitted_ordinary_dividend_without_approval',
      segment: null,
      capital_group: 'TST Life Insurance Co',
      value: 100,
      unit: 'USD',
      unit_scale: 'millions',
      fiscal_year: 2026,
      fiscal_period: 'FY',
      accession_number: '0000000000-25-000001',
      filing_date: '2026-02-20',
      form: '10-K',
      report_date: '2025-12-31',
      primary_document: 'tst-2025x10k.htm',
      source_statement: 'synthetic third insurer',
      earnings_basis: 'not_applicable',
    });
    (data.financials_native as unknown as Record<string, unknown>).life_insurance_filing_facts = facts;
    expect(() => buildSourcedLifeInsuranceAssumptions(data)).toThrow(/segment earnings forecasts|capital schedule/i);
  });
});
