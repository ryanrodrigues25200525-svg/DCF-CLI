# Integrated Oil and Gas Model Implementation Plan

> Continue inline in the current dirty checkout. Run only live checks in `model/src/cli.live.test.ts`; do not stage, commit, reset, or discard existing changes.

**Goal:** Build `integrated_energy_dcf` for XOM from filed production/price/reserve and segment data, with a formula workbook and a fail-closed boundary for miners and independent E&Ps.

**Spec:** `docs/superpowers/specs/2026-10-01-integrated-energy-model.md`

## Global constraints

- Use live SEC filings and dated current market inputs; do not add fixture-only tests.
- Preserve reported ownership scope, period, source-table label, units, scale, accession, and filing date.
- Keep GAAP and non-GAAP earnings separate; do not use reserve quantities as a balancing plug or add reserve NAV to the DCF.
- Keep a company blocked when segment, commodity, CapEx, working-capital, or equity-bridge history is missing/ambiguous.
- Forecast formulas remain editable; Python writes filed actuals and provenance only.

### Task 1: Extract XOM live production, reserve, price, cost, segment, and CapEx tables

**Files:** modify `backend/app/services/edgar.py`, `backend/app/api/contracts.py`, `model/src/core/types/native.ts`, and `model/src/cli.live.test.ts`.

- [x] Add a live XOM filing test for 2023–2025 oil/gas volumes, realized product prices, production costs, reserve balances, segment earnings/CapEx, and source metadata.
- [x] Add an unsupported live independent-E&P edge case; CVX is classified as energy and blocked outside the XOM contract.
- [x] Run the live XOM source assertions against the current extraction path and close the identified parser gaps.
- [x] Implement deterministic 10-K table parsing with ownership-scope and unit conversion checks.
- [x] Re-run live extraction and compare values with the filed production, reserve, segment, and cash-flow tables.

### Task 2: Add canonical energy history and production-only readiness

**Files:** modify `backend/app/services/valuation/canonical.py`, `backend/app/services/valuation/classifier.py`, `backend/app/api/contracts.py`, and the TypeScript SEC contracts/normalizer.

- [x] Add a typed annual energy block for production, realized prices, unit costs, proved reserves, segment earnings, D&A/PP&E additions, and source-based cash-flow inputs.
- [x] Preserve filed consolidated/equity-company production scope and reconcile volumes and segment earnings; missing values remain missing.
- [x] Require three aligned years and a current market/common-equity bridge; enable XOM only after calculation and formula adapter acceptance.
- [x] Keep other energy issuers, miners, independent E&Ps, and midstream companies outside the XOM route until each has an appropriate source contract.

### Task 3: Implement the integrated segment and upstream DCF engine

**Files:** create `model/src/services/valuation/integrated-energy-model.ts` and `integrated-energy-assumption-policy.ts`; modify model types, router, and job orchestration.

- [x] Add live XOM engine assertions for volume/price/cost schedules, reserve/replacement metrics, segment earnings, CapEx, FCFF, WACC, equity bridge, and per-share value.
- [x] Run live engine assertions and correct upstream base-margin and tax-rate parity before production routing.
- [x] Forecast Upstream from separate oil/gas prices, production growth, and unit-cost assumptions; use filed sensitivity only as an independent check.
- [x] Forecast Energy Products, Chemical Products, Specialty Products, and Corporate/Financing separately; keep segment earnings and financing adjustments visible.
- [x] Calculate unlevered cash flow from after-tax segment earnings, D&A, cash CapEx, and working-capital investment, with reserve/production consistency checks.
- [x] Verify price, production, production cost, CapEx, WACC, terminal-growth, debt, and share-count value directions.

### Task 4: Build a formula-driven Integrated Energy workbook

**Files:** add a TypeScript payload builder and `backend/app/services/excel_export/mappers/integrated_energy_model.py`; modify export contracts and mapper dispatch.

- [x] Add live XOM export assertions for blue inputs, editable formulas, reserve/segment checks, sources, equity bridge, and no broken references.
- [x] Run the live export assertions, identify the row-mapping and engine-parity gaps, and correct them before enabling the route.
- [x] Implement `Integrated Energy Model` and `Data Review`; forecast and valuation outputs remain Excel formulas.
- [x] Recalculate with LibreOfficeDev, confirm engine parity/no formula errors, and inspect rendered workbook pages. Artifact Tool was unavailable in the active tool set.

### Task 5: Enable XOM after acceptance and publish the boundary

- [x] Add live CLI XOM export and live unsupported-E&P block cases; CVX exits before creating a workbook.
- [x] Add `integrated_energy_dcf` to production calculation/export registries after source, engine, and workbook acceptance passed.
- [x] Update README and CLI architecture documentation with tested support and remaining limits.

### Task 6: Verify energy and full live-only suite

- [x] Compare engine and workbook equity value within 0.1% and per-share value within $0.01; test commodity, production, cost, CapEx, WACC, growth, debt, and share-count sensitivities.
- [x] Run the live-only `npm test` (66/66), TypeScript typecheck, Python compilation, and `git diff --check` after the scoped specialist routes passed acceptance.
