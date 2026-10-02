# P&C Insurance Model Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` task by task. This is a continuation of the approved company-specific sector-model design; retain live-only tests and do not stage or commit.

**Goal:** Replace the insurer draft with a source-traceable P&C underwriting, reserve, capital, and residual-income model.

**Architecture:** Extend the backend canonical payload with P&C-specific annual lines and subtype/readiness. A TypeScript engine consumes those lines and current dated market inputs. A dedicated Python mapper writes a formula-driven Insurance Model workbook from sourced actuals and editable assumptions.

**Tech Stack:** TypeScript, Vitest live-only suite, FastAPI/Pydantic, SEC `edgartools`, OpenPyXL, bundled Artifact Tool recalculation.

**Spec:** `docs/superpowers/specs/2026-09-30-pc-insurance-model.md`

## Global Constraints

- Keep P&C, life, reinsurer, title, mortgage, and mixed insurer subtypes distinct; enable only the source-ready P&C route.
- Preserve source value, period, accession, filed date, currency, unit, scale, normalization, and model method.
- Missing, ambiguous, stale, default, or unsupported inputs block the route; never replace them with zero or hidden plugs.
- Forecast and valuation calculations are editable Excel formulas linked to visible assumptions.
- Add and run only live-source tests; preserve the dirty worktree; do not stage or commit.

## Review Focus

1. **Premium basis:** written, earned, gross, net, direct, and assumed premiums must not be mixed.
2. **Loss/expense definitions:** the combined ratio must match the issuer's filed definition and denominator.
3. **Reserves:** loss and LAE reserves, prior-year development, and paid/incurred claims must not be conflated.
4. **Investment income:** separate underwriting earnings from investment income and avoid double-counting invested assets.
5. **Subtype and capital:** AIG must pass the P&C scope gate; if its non-P&C operations are material and cannot be separated, keep AIG blocked.

---

### Task 1: Map P&C actuals and issuer subtype

**Files:** `backend/app/services/valuation/canonical.py`, `backend/app/api/contracts.py`, `backend/app/services/valuation/classifier.py`, `model/src/core/types/native.ts`, `model/src/api/contracts.ts`, `model/src/services/integration/sec/native-normalizer.ts`, `model/src/cli.live.test.ts`.

**Interfaces:** Produce `canonical_financials.annual[].insurance` with typed lines for `written_premiums`, `earned_premiums`, `losses_and_lae`, `underwriting_expense`, `net_investment_income`, `invested_assets`, `unpaid_loss_reserves`, `common_equity`, `common_equity_distributions`, `diluted_shares`, and any filed statutory capital/RBC lines needed by the selected valuation. Produce subtype `pc_insurer | life_insurer | reinsurer | other_insurer` and per-line readiness.

- [x] Add the live AIG mapping test; compare the latest and comparative FY lines against filed 10-K rows/notes. Assert units, sources, period, accession, and explicitly derived methods.
- [x] Run the live test red against the blocked route before implementation.
- [x] Inspect AIG's latest 10-K segment mix and P&C premium/reserve/capital tables. General Insurance underwriting/investment income and Other Operations remain separate; common equity and statutory capital proxies are disclosed.
- [x] Implement deterministic mapping in the backend canonical path; keep missing/ambiguous lines null and source-visible.
- [x] Map the typed P&C block in `native-normalizer.ts`; add a live MET life-insurer block assertion.
- [x] Run the focused live mapping check and full live-only suite after all approved sector routes are updated; 22/22 live tests passed on 2026-09-30.

### Task 2: Implement the P&C forecast and equity valuation

**Files:** create `model/src/services/valuation/insurance-model.ts`; modify `model/src/services/valuation/router.ts`, `model/src/core/types/model.ts`, and `model/src/cli.live.test.ts`.

**Interfaces:** `mapCanonicalInsuranceFinancialsToHistoricals(canonical) -> InsuranceHistoricalData`; `calculateInsuranceValuation(history, assumptions) -> InsuranceModelResult`. Forecast earned premiums, loss/LAE, underwriting expenses, underwriting profit, invested assets/income, reserve development, taxes, net income, common equity, and capital-constrained distributions. Use common-equity residual income; `enterpriseValue` is null.

- [x] Add a live engine test that reconciles underwriting profit, loss ratio, expense ratio, combined ratio, investment income, reserve roll-forward, capital, residual income, and per-share value from AIG.
- [x] Run the test red against the P&C readiness gate before enabling the route.
- [x] Implement the formula engine with explicit assumptions and source checks; terminal growth must be below cost of equity.
- [x] Dispatch `insurance_pnc_residual_income` only when P&C subtype, source coverage, and current dated market inputs pass.
- [x] Run the full live-only suite after all approved sector routes are updated; 22/22 live tests passed on 2026-09-30.

### Task 3: Export the P&C formula workbook

**Files:** create `backend/app/services/excel_export/mappers/insurance_model.py`; modify `backend/app/api/contracts.py`, `model/src/services/exporters/excel/types.ts`, `model/src/services/exporters/excel/insurance-payload.ts`, `model/src/application/run-valuation-job.ts`, and `model/src/cli.live.test.ts`.

**Interfaces:** `DcfExportPayload.insuranceModel` contains canonical history, source records, editable assumptions and dated valuation inputs. The `Insurance Model` workbook shows premiums, ratios, investment income, reserves, capital, common-equity residual income, sensitivity, and reconciliation formulas.

- [x] Add a live exporter test that asserts blue inputs, a formula-driven five-year forecast, reserve/capital checks, source metadata, no `#REF!`, and formula-based forecasts.
- [x] Run the live export test red while the AIG route was still blocked.
- [x] Implement `apply_insurance_model`; keep GAAP, company-reported underwriting metrics, and analyst normalization separate.
- [x] Recalculate with Artifact Tool; no formula errors, sensitivity directions correct, equity-value relative error 1.9e-16, and share-price error below $0.01.
- [x] Run the full live-only suite after all approved sector routes are updated; 22/22 live tests passed on 2026-09-30.

### Task 4: Enable only the accepted P&C subtype

- [x] Add a live CLI end-to-end test for AIG and a live life-insurer MET block; blocked cases do not write workbooks.
- [x] Enable the P&C route after source, engine, formula workbook, and recalculation checks passed.
- [x] Update support-boundary docs with the P&C example and remaining insurer blocks.
- [x] Run the full live-only suite after all approved sector routes are updated; 22/22 live tests passed on 2026-09-30.

## Execution

Continue inline using `superpowers:executing-plans`; do not delegate, stage, or commit. A successful AIG model covers only the tested, isolated P&C business scope.
