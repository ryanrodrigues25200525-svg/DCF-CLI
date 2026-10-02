# Integrated Oil and Gas Model

**Status:** Live SEC source audit supports Exxon Mobil (XOM) as the first implementation candidate (2026-10-01)

## Goal

Add a source-backed valuation for integrated oil and gas companies whose SEC filings disclose production, realized prices, production costs, reserves, segment earnings, reinvestment, and common-equity claims. The first model should be issuer-specific to XOM's reported segment definitions and remain blocked for miners, independent E&Ps, and integrated issuers whose segments or cash flows do not reconcile.

## Live source audit

XOM's FY2025 Form 10-K (filed 2026-02-18, accession `0000034088-26-000045`) contains three-year production, realized price, and production-cost tables. FY2025 reports 3.329 million barrels/day of liquids production, 8.442 billion cubic feet/day of gas available for sale, 4.736 million barrels/day of oil-equivalent production, total realized crude prices of $65.18/bbl, gas prices of $4.28/mcf, and consolidated production cost of $10.20 per oil-equivalent barrel. The filing also reports 19.311 billion barrels of oil-equivalent proved reserves, including 12.304 billion developed and 7.007 billion undeveloped.

The 10-K separately reports Upstream, Energy Products, Chemical Products, Specialty Products, and Corporate and Financing results and driver analyses; corporate and segment capital spending; cash-flow CapEx; dated production-price sensitivities; debt; and other bridge inputs. The current SEC standard-company-facts adapter does not expose all of these segment/engineering tables as a canonical series, so the production feed needs its own 10-K parser and provenance contract.

## Valuation method

- Build an upstream schedule from filed liquid and natural gas production, product-level realized prices, production cost per oil-equivalent barrel, proved reserve balances, and reserve-life/replacement checks.
- Forecast Upstream operating earnings using editable oil/gas price, production growth, and unit-cost drivers. Use filed issuer price sensitivity as a separate cross-check; it is not an automatic earnings plug.
- Forecast Energy Products, Chemical Products, Specialty Products, and Corporate/Financing on separate reported earnings and cash-capital schedules. Do not treat gross commodity price inflation as consolidated revenue growth.
- Convert segment operating earnings to an unlevered operating cash-flow forecast with filed D&A, cash CapEx, operating-working-capital investment, cash taxes or clearly disclosed after-tax segment earnings, and a dated WACC.
- Use an unlevered DCF for the common enterprise valuation. Show a reserve/production sensitivity and WACC/terminal-growth sensitivity; reserve quantity is a production constraint and cross-check, not a second valuation added to the DCF.
- Preserve GAAP segment/financial actuals and management's non-GAAP adjusted earnings separately. Any selected normalized series and adjustment must be visible and source-backed.

## Eligibility boundary

- Production model ID: `integrated_energy_dcf`.
- First candidate: Exxon Mobil (`XOM`). The first release covers integrated oil and gas only when segment and engineering tables reconcile.
- Do not enable a company from energy SIC alone. Block independent E&Ps without source-ready production economics, miners requiring grade/recovery/strip-ratio schedules, and utilities or midstream companies with different cash-flow drivers.
- Require three consecutive years of liquid/gas production, realized prices, production cost, reserve history, segment operating results, CapEx, working capital, diluted shares, interest-bearing debt, live price/beta, and dated WACC sources.

## Workbook

Create `Integrated Energy Model` and `Data Review` sheets. Keep commodity prices, production, unit costs, segment revenue/earnings, corporate items, CapEx, working capital, taxes, WACC, and terminal growth separate and editable. The sheet must expose reserve/production identity checks, segment-to-consolidated reconciliation, FCFF, equity bridge, price sensitivity, and WACC/terminal-growth sensitivity as formulas. Python writes filed actuals and source metadata only.

## Acceptance

- Live XOM 10-K rows reconcile exactly to source periods, table units, production conversions, and filing lineage.
- The model preserves the ownership scope of consolidated subsidiaries versus equity companies and does not double-count equity-company production or earnings.
- Production, reserves, and price sensitivities are directionally correct; operating cash flow reconciles; missing reserve/segment/bridge values block support.
- Recalculated formula workbook has no errors; engine/workbook common-equity value ties within 0.1% and per-share value within $0.01.
- A live XOM route exports only after all source, engine, formula workbook, and recalculation checks pass. A live miner or independent E&P with a different/missing source profile stays blocked.
