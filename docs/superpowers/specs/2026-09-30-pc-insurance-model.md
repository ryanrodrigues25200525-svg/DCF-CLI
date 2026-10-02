# Property and Casualty Insurance Model

**Status:** Implemented and live-validated for AIG's disclosed General Insurance/P&C scope (2026-09-30)

**Date:** 2026-09-30

## Goal

Add a separate P&C underwriting and common-equity valuation route for insurers whose filed business mix and source history meet the P&C readiness gate. Life insurers and materially mixed financial groups remain blocked unless their non-P&C businesses can be separated from the supported P&C operations.

## Model design

- Use one canonical source-selection path for insurer annuals. Preserve each line's concept, period, source filing/accession, filed date, currency, units, scale, sign convention, and derivation method.
- Map gross written premiums, net written premiums, earned premiums, losses and loss-adjustment expenses, acquisition/underwriting expenses, net investment income, invested assets, unpaid-loss reserves, parent common equity, common dividends/repurchases, and diluted shares where the issuer reports them.
- For AIG, keep its reported General Insurance segments separate from `Other Operations` (parent portfolio/Corebridge dividend income, corporate expense, and interest). Reconcile the P&C underwriting/investment schedule and Other Operations to the consolidated pretax result; do not treat parent/Corebridge investment income as P&C portfolio yield.
- The AIG reserve schedule uses filed opening net reserves, incurred and paid losses, other reserve changes, reinsurance recoverables, and ending gross/net reserves. Reserve movements reconcile before forecasting; `other reserve changes` that mix FX/dispositions/reinsurance are a visible editable assumption, never an unexplained plug.
- Display written and earned premiums separately. Calculate loss ratio, expense ratio, and combined ratio from the filed premium basis and expense definitions. Do not treat premium volume as revenue growth without a source-backed premium build.
- Forecast earned premiums from editable premium growth and retention/pricing assumptions; forecast losses and underwriting expenses from editable ratios; forecast investment income from average invested assets and an editable yield. Show reserve balances and changes separately from underwriting income.
- Value common equity with a residual-income framework using common book value, common net income, common distributions, dated cost of equity, and a sustainable terminal assumption. Enterprise value and corporate FCFF are not applicable.
- Required regulatory capital or statutory surplus inputs must be filed/source-backed or explicitly analyst-specified with source notes. If a required capital check cannot be built from issuer disclosures, keep the issuer blocked.

## Eligibility boundary

- Support only verified P&C insurers with a source-complete underwriting history. Do not enable life, annuity, reinsurer, mortgage, title, or mixed insurer subtypes through the P&C route.
- AIG is the first live mapping case; its actual reported segment mix must pass the P&C scope gate before an export is supported.
- Require current, dated market inputs for price, shares, beta, risk-free rate, and ERP. Default, stale, unavailable, missing, or ambiguous required data blocks valuation.

## Workbook requirements

Create an `Insurance Model` sheet and a `Data Review` sheet. Historical values are sourced inputs with accession/date/unit notes. Forecast assumptions are blue, editable cells; forecasts, ratios, reserve roll-forward, capital checks, residual income, valuation bridge, and sensitivities are readable Excel formulas. Python provides source facts and labels, not static forecast results.

Material review notes must identify company-defined premium and combined-ratio definitions, reserve-development treatment, investment income, preferred/noncontrolling claims, and any regulatory capital proxy. A polished export is not evidence of investment-banking-grade or universal P&C coverage.

## Acceptance

- Live AIG source mapping agrees with the filed 10-K table rows for the latest and comparative periods; source and unit metadata remain attached.
- The model blocks if a required P&C line is missing, ambiguous, or from an incompatible insurer subtype.
- Underwriting, reserve, investment, capital, and common-equity identities reconcile from visible formula inputs.
- Changing premium growth/yield increases value when other assumptions are held constant; higher loss ratio, reserve provision, or cost of equity reduces value.
- The formula workbook recalculates with no formula errors and matches the live engine within 0.1% equity value and $0.01 per share before display rounding.
- A live AIG case and a live non-P&C insurer/subtype block are in the test suite. Passing AIG does not imply support for all insurers.
