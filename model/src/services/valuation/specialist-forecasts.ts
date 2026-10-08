import type { ForecastYear } from '@/core/types';
import type { BiotechRnpvForecastYear } from '@/services/valuation/biotech-rnpv-model';
import type { LifeInsuranceForecastYear } from '@/services/valuation/life-insurance-model';
import type { TelecomForecastYear } from '@/services/valuation/telecom-model';
import type { UtilityForecastYear } from '@/services/valuation/utility-model';

/**
 * Specialist engines report rich sidecar forecasts (rate-base dividends,
 * pipeline rNPV cash flows, distributable earnings, subscriber FCF) while the
 * canonical `ForecastYear` contract only carries operating-DCF detail. These
 * mappers carry the specialist cash-flow year into the canonical shape with
 * explicit zeros elsewhere (never fabricated operating detail) so generic
 * consumers never see a supported valuation with `forecasts: []` (#58).
 * Specialist detail stays in each result's sidecar for the workbook branches.
 */
export function blankForecastYear(year: number): ForecastYear {
  return {
    year,
    revenue: 0, revenueGrowth: 0, costOfRevenue: 0, grossProfit: 0, grossMargin: 0,
    ebitda: 0, ebitdaMargin: 0, ebit: 0, ebitMargin: 0,
    interestExpense: 0, preTaxIncome: 0, taxExpense: 0, effectiveTaxRate: 0,
    netIncome: 0, netMargin: 0, taxShieldUsed: 0, nolBalance: 0,
    rdExpense: 0, sgaExpense: 0, depreciation: 0, stockBasedComp: 0, nwcChange: 0,
    cfo: 0, capex: 0, reinvestment: 0, fcff: 0, fcfe: 0,
    cash: 0, totalCurrentAssets: 0, otherCurrentAssets: 0,
    ppeNet: 0, otherAssets: 0, totalAssets: 0,
    totalDebt: 0, currentDebt: 0, shortTermDebt: 0, longTermDebt: 0,
    otherLiabilities: 0, deferredRevenue: 0, otherCurrentLiabilities: 0,
    totalCurrentLiabilities: 0, nonCurrentLiabilities: 0,
    commonStock: 0, retainedEarnings: 0,
    arDays: 0, inventoryDays: 0, apDays: 0,
    shareholdersEquity: 0, investedCapital: 0,
    dividends: 0, shareBuybacks: 0, debtIssuance: 0, debtRepayment: 0,
    totalLiabilities: 0, accountsReceivable: 0, inventory: 0, accountsPayable: 0,
    nwc: 0, roic: 0, economicProfit: 0,
    discountFactor: 0, pvFcff: 0, pv: 0,
  };
}

export function mapUtilityForecasts(rows: UtilityForecastYear[]): ForecastYear[] {
  return rows.map((row) => ({
    ...blankForecastYear(row.year),
    fcff: row.commonDividends, fcfe: row.commonDividends, dividends: row.commonDividends,
    discountFactor: row.discountFactor, pvFcff: row.presentValueOfDividends, pv: row.presentValueOfDividends,
  }));
}

export function mapBiotechForecasts(rows: BiotechRnpvForecastYear[]): ForecastYear[] {
  return rows.map((row) => ({
    ...blankForecastYear(row.year),
    fcff: row.totalFcf, fcfe: row.totalFcf,
    discountFactor: row.discountFactor, pvFcff: row.presentValueOfFcf, pv: row.presentValueOfFcf,
  }));
}

export function mapLifeForecasts(rows: LifeInsuranceForecastYear[]): ForecastYear[] {
  return rows.map((row) => ({
    ...blankForecastYear(row.year),
    fcff: row.distributableEarnings, fcfe: row.distributableEarnings,
    discountFactor: row.discountFactor,
    pvFcff: row.presentValueOfDistributableEarnings, pv: row.presentValueOfDistributableEarnings,
  }));
}

export function mapTelecomForecasts(rows: TelecomForecastYear[]): ForecastYear[] {
  return rows.map((row) => ({
    ...blankForecastYear(row.year),
    revenue: row.totalRevenue, ebit: row.ebit, depreciation: row.depreciation, capex: row.capex,
    nwcChange: row.workingCapitalChange,
    fcff: row.freeCashFlow, fcfe: row.freeCashFlow,
    discountFactor: row.discountFactor, pvFcff: row.presentValueFreeCashFlow, pv: row.presentValueFreeCashFlow,
  }));
}
