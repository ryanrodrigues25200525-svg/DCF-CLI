# Mature Pharma Product-and-Patent Model Implementation Plan

> Continue inline in the current dirty checkout. Run only live checks in `model/src/cli.live.test.ts`; do not stage, commit, reset, or discard existing changes.

**Goal:** Build a source-backed, formula-driven five-year product-and-patent DCF for Pfizer (PFE), and fail closed for other pharmaceutical issuers until they meet the same source contract.

**Spec:** `docs/superpowers/specs/2026-10-01-mature-pharma-model.md`

## Constraints

- Use live SEC filings, current dated market/WACC inputs, and source-ready equity bridge inputs.
- Preserve product label, reported geography, regional patent dates, unit/scale, accession, and filed date.
- Keep filed patent years separate from the editable modeled global LOE year and erosion assumptions.
- Keep GAAP income and product revenue separate from analyst assumptions; do not add pipeline NAV.
- Only PFE may route to this issuer-specific model; MRK and other pharmaceutical companies remain blocked.
- Forecasts are Excel formulas; Python writes filed actuals and provenance only.

### Task 1: Audit and map live PFE product and patent tables

**Files:** `backend/app/services/edgar.py`, API/canonical contracts, and `model/src/cli.live.test.ts`.

- [x] Add live product-sales, total-revenue, short-term-investment, and U.S./Europe/Japan patent-table assertions for FY2023–FY2025.
- [x] Add a live MRK source-contract block case.
- [x] Run the source assertions against the existing feed, then implement deterministic SEC 10-K parsing for product, patent, and balance-sheet rows.
- [x] Reconcile the mapped product rows plus an explicit unallocated/alliance residual to filed total revenue; correct the FY2023 consolidated-revenue mapping.

### Task 2: Add typed product history and PFE-only readiness

**Files:** `backend/app/api/contracts.py`, `backend/app/services/valuation/canonical.py`, `backend/app/services/valuation/classifier.py`, `model/src/core/types/native.ts`, `model/src/api/contracts.ts`, and `model/src/services/integration/sec/native-normalizer.ts`.

- [x] Add typed annual product revenue and regional patent-expiry history with filing lineage.
- [x] Require three aligned years, a reconciled sales residual, current market data, WACC sources, and a complete common-equity bridge including filed short-term investments.
- [x] Report each readiness gate; allow only PFE through `mature_pharma_product_dcf`.

### Task 3: Implement product schedule and DCF engine

**Files:** create `model/src/services/valuation/mature-pharma-model.ts` and its assumption policy; modify router/job orchestration/types.

- [x] Add a live PFE engine assertion for product actuals, LOE timing, revenue bridge, FCFF, WACC, equity bridge, and per-share value.
- [x] Run live engine assertions on the new calculation path and resolve input/margin concerns before route enablement.
- [x] Forecast mapped products separately with editable pre-LOE growth and post-LOE erosion; keep unallocated/alliance revenue separate.
- [x] Forecast consolidated EBIT, tax, D&A, CapEx, and working capital with visible editable assumptions.
- [x] Verify value directions for growth, modeled LOE year, erosion, operating margin, WACC, terminal growth, debt, and share count.

### Task 4: Build and verify the editable workbook

**Files:** create TypeScript payload/export types and `backend/app/services/excel_export/mappers/mature_pharma_model.py`; update Python/TypeScript route dispatch.

- [x] Add a live export assertion for formula-driven product schedules, blue inputs, regional patent source rows, the source review, and no broken references.
- [x] Run live export assertions against the formula mapper and correct issues before enabling the route.
- [x] Build `Mature Pharma Model` and `Data Review` without fixed forecast values.
- [x] Recalculate with LibreOfficeDev; verify engine parity, LOE and WACC sensitivities, formula-error checks, and rendered workbook output.

### Task 5: Enable only the accepted issuer and publish scope

- [x] Add `mature_pharma_product_dcf` to calculation/export production registries after source, engine, and workbook acceptance passed.
- [x] Add a live PFE CLI export and confirm a live MRK block writes no workbook.
- [x] Update README and CLI architecture documentation with the exact PFE-only boundary and limitations.

### Task 6: Final verification

- [x] Run focused live PFE engine, workbook, source-readiness, and CLI cases plus a live MRK block.
- [x] Run the complete live-only `npm test` (66/66), TypeScript typecheck, Python compilation, and `git diff --check` after all scoped family audits.
