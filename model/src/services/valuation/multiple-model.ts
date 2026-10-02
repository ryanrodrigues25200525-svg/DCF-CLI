import type { DCFResults, PreferredValuationModel } from '@/core/types';

export type ComparableValuationMethod = Extract<PreferredValuationModel, 'ev_ebitda' | 'revenue_multiple'>;

export interface ComparableValuationInput {
  method: ComparableValuationMethod;
  targetMetric: number;
  selectedMultiple: number;
  cash: number;
  marketableSecurities: number;
  debt: number;
  nonControllingInterest: number;
  preferredEquity: number;
  dilutedShares: number;
  currentPrice: number;
}

export function calculateComparableValuation(input: ComparableValuationInput): DCFResults {
  const values = [
    input.targetMetric,
    input.selectedMultiple,
    input.cash,
    input.marketableSecurities,
    input.debt,
    input.nonControllingInterest,
    input.preferredEquity,
    input.dilutedShares,
    input.currentPrice,
  ];
  if (values.some((value) => !Number.isFinite(value))) {
    throw new Error('Comparable valuation inputs must be finite.');
  }
  if (input.targetMetric <= 0 || input.selectedMultiple <= 0
    || input.cash < 0 || input.marketableSecurities < 0 || input.debt < 0
    || input.nonControllingInterest < 0 || input.preferredEquity < 0
    || input.dilutedShares <= 0 || input.currentPrice <= 0) {
    throw new Error('Comparable valuation requires positive operating metric, multiple, shares, and price, and non-negative bridge amounts.');
  }

  const enterpriseValue = input.targetMetric * input.selectedMultiple;
  const equityValue = enterpriseValue
    + input.cash
    + input.marketableSecurities
    - input.debt
    - input.nonControllingInterest
    - input.preferredEquity;
  const impliedSharePrice = Math.max(0, equityValue / input.dilutedShares);
  return {
    forecasts: [],
    terminalValue: 0,
    pvTerminalValue: 0,
    enterpriseValue,
    equityValue,
    impliedSharePrice,
    shareCount: input.dilutedShares,
    currentPrice: input.currentPrice,
    upside: (impliedSharePrice - input.currentPrice) / input.currentPrice,
    terminalValueGordon: 0,
    terminalValueExitMultiple: input.selectedMultiple,
    tvDivergenceFlag: false,
    avgROIC: 0,
    valueCreationFlag: false,
    confidenceScore: 0.5,
    confidenceRank: 'Medium',
    modelWarning: input.method === 'ev_ebitda'
      ? 'EV/EBITDA trading-comparables valuation; no forecast cash-flow discounting is applied.'
      : 'EV/Revenue trading-comparables valuation; no forecast cash-flow discounting is applied.',
    isValuationSupported: true,
    isSensitivitySupported: true,
    preferredModel: input.method,
    valuationBasis: 'enterprise',
  };
}
