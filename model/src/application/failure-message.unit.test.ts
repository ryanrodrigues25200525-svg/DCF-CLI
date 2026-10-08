import { describe, expect, it } from 'vitest';
import type { Assumptions, DCFResults, HistoricalData } from '@/core/types';
import type { ModelEligibility } from '@/core/types/native';
import { valuationFailureMessage } from '@/application/run-valuation-job.js';

function eligibilityFor(model: ModelEligibility['preferred_model']): ModelEligibility {
  return {
    company_type: 'operating',
    preferred_model: model,
    allowed_models: [model],
    blocked_models: [],
    supported_by_current_engine: false,
    status: 'ready',
    model_route_available: true,
    missing_input_gaps: [],
  };
}

const results = {
  isValuationSupported: false,
  impliedSharePrice: 0,
  enterpriseValue: 0,
  equityValue: 0,
  shareCount: 0,
  forecasts: [],
  terminalValue: 0,
  terminalValueGordon: 0,
} as unknown as DCFResults;

const assumptions = {
  wacc: 0.09,
  taxRate: 0.21,
  ebitMargin: 0.2,
  capexRatio: 0.05,
  nwcChangeRatio: 0.01,
} as unknown as Assumptions;

describe('valuation failure diagnostics (#56)', () => {
  it('keeps operating internals for the operating DCF', () => {
    const message = valuationFailureMessage('TST', eligibilityFor('unlevered_dcf'), results, assumptions);
    expect(message).toMatch(/WACC=0\.09/);
  });

  it('names the specialist model and forecast count instead of operating internals', () => {
    const message = valuationFailureMessage('TST', eligibilityFor('bank_residual_income'), results, assumptions);
    expect(message).toMatch(/bank_residual_income/);
    expect(message).toMatch(/forecasts=0/);
    expect(message).not.toMatch(/WACC=/);
    expect(message).not.toMatch(/EBIT margin=/);
  });
});
