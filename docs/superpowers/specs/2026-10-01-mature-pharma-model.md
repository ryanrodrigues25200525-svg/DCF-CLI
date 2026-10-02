# Mature Pharma Product-and-Patent DCF

**Status:** PFE is the first source-complete implementation candidate; other pharmaceutical issuers remain blocked (2026-10-01)

## Goal

Add a separate public-company DCF route for mature pharmaceutical companies whose annual filings disclose a reconciled multi-year product-revenue table and product-level patent or regulatory-exclusivity timing. The first release is issuer-specific to Pfizer (PFE). It should give analysts editable, legible product and loss-of-exclusivity formulas without pretending that a filed patent date is a forecast of generic entry or sales erosion.

## Evidence and boundary

Pfizer's FY2025 10-K (filed 2026-02-26, accession `0000078003-26-000026`) reports a product-sales table for FY2023–FY2025 and a patent table with U.S., major-Europe, and Japan basic product patent expiration years. Its consolidated statement reports total revenue, operating costs, operating income, taxes, D&A, capital spending, and working-capital movements. The revenue table groups several product families and includes other/alliance revenue that is not disclosed by product and territory.

The filing does not supply product-level territory mix, expected generic launch dates, post-exclusivity erosion curves, future product pricing, or management-approved product forecasts. Therefore:

- Patent dates remain filed inputs, with U.S., Europe, and Japan shown separately.
- A distinct blue `Modeled global LOE year` is an editable analyst assumption, initialized from the filed U.S. basic patent year when available. It is not described as a fact. The workbook discloses that regional sales mix and legal/regulatory exclusivity can move the realized global event.
- Product-specific pre-LOE growth and post-LOE erosion assumptions remain editable. They are not presented as company guidance or consensus.
- Product families whose revenue row cannot be reconciled to an individual patent line remain visible with patent timing marked missing; they use an editable non-product/product-family forecast assumption instead of an inferred match.
- Alliance, royalty, and other unallocated revenue remains a separate aggregate schedule.
- The model forecasts GAAP revenue, operating income, taxes, D&A, CapEx, and operating working capital through an unlevered DCF. It does not add pipeline or patent-option NAV to the DCF.
- PFE is the only source-complete mature-pharma issuer in this release. MRNA uses a separate input-required pipeline rNPV route; MRK and other mature-pharma issuers, and life insurers, require their own source contracts.

## Model method

1. Map actual product revenue and reported total revenue for FY2023–FY2025; keep other/alliance revenue as a reconciled residual.
2. For each source-mapped product row, show three filed actual years, filed U.S./Europe/Japan basic patent expiration years, and editable analyst assumptions for pre-LOE growth and post-LOE erosion.
3. Forecast each product with a readable annual formula: grow at the editable product rate through the modeled global LOE year, then apply the editable erosion assumption. Keep the modeled LOE input separate from each filed regional patent year.
4. Forecast unallocated/alliance revenue, EBIT margin, tax, D&A, CapEx, and working capital using editable assumptions initialized from source-ready historical calculations. Show the historical denominator and calculation.
5. Calculate FCFF, dated CAPM/WACC, Gordon-growth terminal value, enterprise-to-common-equity bridge, per-share value, and WACC/growth and LOE sensitivities.

## Workbook requirements

Create `Mature Pharma Model` and `Data Review` sheets. The operating sheet shows actual and forecast product rows, regional patent years, the modeled LOE assumption, the revenue and EBIT bridge, FCFF, valuation, and checks. Blue cells are analyst or current-market inputs; formulas are visible and referenced directly by the forecast. `Data Review` retains each product value, patent disclosure, SEC concept/table label, accession, filing date, fiscal period, unit, and any normalization. Python maps filed actuals and provenance only; Excel owns forecast and valuation formulas.

## Eligibility and acceptance

- Production model ID: `mature_pharma_product_dcf`.
- PFE must have three aligned product-revenue years; a total-sales reconciliation; live market, WACC, and common-equity bridge inputs; and source-backed consolidated operating, D&A, CapEx, and working-capital history.
- At least 60% of the latest filed total revenue must map to a product row with a filed U.S. basic patent year; the remainder stays in separately labeled product/other revenue schedules.
- A live MRK or other pharma edge case must be blocked until its own source contract is mapped.
- Product revenue must aggregate to the filed total within the disclosed residual; patent region and pending-extension text must not be collapsed into a false single date.
- The live engine must reconcile to the formula workbook within 0.1% of common-equity value and $0.01/share after LibreOffice recalculation, with no formula errors.
- Higher pre-LOE growth increases value; earlier modeled LOE or greater post-LOE erosion decreases value; higher EBIT margin and terminal growth increase value; higher WACC, debt, or shares reduce the appropriate valuation output.
- One issuer passing does not imply support for other pharmaceutical or biotechnology companies.
