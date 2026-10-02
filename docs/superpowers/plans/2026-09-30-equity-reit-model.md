# Equity REIT Model Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` task by task. This is a continuation of the approved company-specific sector-model design; retain live-only tests and do not stage or commit.

**Goal:** Replace the generic REIT draft with a source-traceable equity REIT property, FFO/AFFO, NAV, and common-equity workbook.

**Architecture:** Add a canonical REIT operating block and subtype readiness in Python. A TypeScript engine forecasts property/NOI, recurring capex, FFO/AFFO and common-equity value. A dedicated Python mapper writes formulas and issuer-specific source reconciliations.

**Tech Stack:** TypeScript, Vitest live-only suite, FastAPI/Pydantic, SEC `edgartools`, OpenPyXL, bundled Artifact Tool recalculation.

**Spec:** `docs/superpowers/specs/2026-09-30-equity-reit-model.md`

## Global Constraints

- Support property/equity REITs only; mortgage REITs remain blocked.
- Treat Nareit FFO as a supplemental operating measure; AFFO is issuer/analyst-defined and not standardized.
- Preserve gross consolidated, JV, and attributable common-shareholder amounts separately.
- Missing, ambiguous, stale, or defaulted required inputs block the model; do not turn them into zero.
- All forecast, valuation, and sensitivity calculations are linked Excel formulas; tests use live filings/market sources only.
- Preserve the dirty worktree; no staging or commits.

## Review Focus

1. **FFO reconciliation:** GAAP net income, real estate D&A, property gains/losses, impairments, and NCI must match the issuer/Nareit definition.
2. **AFFO adjustments:** tenant improvements, leasing commissions, straight-line rents, and other adjustments must stay individually visible.
3. **Ownership:** consolidate property and JV data to the REIT's attributable share before per-share valuation.
4. **Growth funding:** recurring maintenance capex is separate from development/growth capex and dividend coverage.
5. **NAV:** cap rates, property NOI, debt, preferred claims, NCI, and diluted units/shares must be period- and currency-consistent.

---

### Task 1: Map equity REIT history and subtype

**Files:** `backend/app/services/valuation/canonical.py`, `backend/app/api/contracts.py`, `backend/app/services/valuation/classifier.py`, `model/src/core/types/native.ts`, `model/src/api/contracts.ts`, `model/src/services/integration/sec/native-normalizer.ts`, `model/src/cli.live.test.ts`.

**Interfaces:** Produce `canonical_financials.annual[].reit` with typed `net_income`, `real_estate_depreciation`, `property_sale_gains`, `ffo`, `affo_adjustments`, `recurring_capex`, `same_store_noi`, `occupancy`, `property_count`, `jv_ownership`, `debt`, `common_equity`, `common_distributions`, and `diluted_shares` as disclosures permit. Classify `equity_reit | mortgage_reit | other_real_estate` with readiness.

- [x] Add the live PLD mapping test for latest and comparative years; reconcile GAAP, NAREIT/Core FFO, recurring capex, same-store NOI, occupancy, and sourced balance-sheet claims.
- [x] Run the acceptance case red while PLD was still blocked.
- [x] Inspect PLD's filed NAREIT FFO bridge, Core FFO, same-store disclosures, and recurring versus development spending. PLD does not report AFFO, so the model labels its own AFFO definition and deductions.
- [x] Implement canonical SEC mapping and provenance. Missing historical same-store growth remains missing when adjacent years came from different same-store populations.
- [x] Add a live AGNC mortgage-REIT block test; focused mapping/calculation/export checks pass. Run the full suite after all sector work.

### Task 2: Implement property, FFO/AFFO, and NAV valuation

**Files:** create `model/src/services/valuation/reit-model.ts`; modify router, model types, normalizer, and `model/src/cli.live.test.ts`.

**Interfaces:** `mapCanonicalReitFinancialsToHistoricals(canonical) -> ReitHistoricalData`; `calculateReitValuation(history, assumptions) -> ReitModelResult` with `valuationBasis: 'equity'`, `enterpriseValue: null`, five-year property forecasts, AFFO and NAV outputs, and no corporate FCFF values.

- [x] Add a live PLD engine test for NOI, occupancy, FFO/AFFO, recurring capex, distributions, NAV, common-equity value, and per-share outputs.
- [x] Run the test red while the REIT route was blocked.
- [x] Forecast NOI, occupancy, Core FFO, recurring costs, distributions, and market-implied property NAV; keep filed NAREIT/Core FFO separate from analyst AFFO.
- [x] Dispatch `reit_affo` only when equity-REIT subtype and required source/market readiness pass; mortgage REITs remain blocked.
- [x] Run the full live-only suite after all approved sector routes are updated; 22/22 live tests passed on 2026-09-30.

### Task 3: Export an editable REIT formula workbook

**Files:** create `backend/app/services/excel_export/mappers/reit_model.py`; modify export contracts, `model/src/services/exporters/excel/reit-payload.ts`, `model/src/application/run-valuation-job.ts`, and the live test file.

**Interfaces:** `DcfExportPayload.reitModel` contains reported history, source metadata, assumptions, and market inputs. The `REIT Model` sheet exposes GAAP-to-FFO, issuer AFFO and analyst adjustments, property/NOI build, recurring capex, debt, NAV bridge, per-share value, and sensitivity formulas.

- [x] Add a live PLD exporter test for editable inputs, formula rows, actual/source metadata, no broken references, and visible FFO/AFFO reconciliation.
- [x] Run the live export test red before implementing the mapper/payload contract.
- [x] Implement `apply_reit_model` with readable formulas and no static Python forecast values.
- [x] Recalculate PLD in Artifact Tool; no formula errors, sensitivities move in expected directions, and DCF/NAV engine parity is exact before rounding.
- [x] Run the full live-only suite after all approved sector routes are updated; 22/22 live tests passed on 2026-09-30.

### Task 4: Enable only ready equity REITs

- [x] Add a live CLI test that exports PLD and blocks AGNC without creating a workbook.
- [x] Update README/CLI docs with PLD scope, analyst AFFO deductions, and the circular market-implied/property-only NAV limits.
- [x] Enable PLD only after mapping, engine, workbook, and recalculation checks passed.
- [x] Run the full live-only suite after all approved sector routes are updated; 22/22 live tests passed on 2026-09-30.

## Execution

Continue inline using `superpowers:executing-plans`; do not delegate, stage, or commit. PLD passing does not imply coverage of all equity REIT property types.
