# Regulated Utility Model Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` task by task. This is a continuation of the approved company-specific sector-model design; retain live-only tests and do not stage or commit.

**Goal:** Replace the utility dividend-growth draft with a rate-base, allowed-return, capex, financing, dividend, and common-equity model for source-ready regulated utilities.

**Architecture:** Add a canonical regulated-utility block and subtype readiness in Python. A TypeScript engine forecasts rate base, authorized returns, financing, and equity cash flows. A dedicated Python exporter writes an editable formula workbook with source and regulatory assumptions visible.

**Tech Stack:** TypeScript, Vitest live-only suite, FastAPI/Pydantic, SEC `edgartools`, OpenPyXL, bundled Artifact Tool recalculation.

**Spec:** `docs/superpowers/specs/2026-09-30-regulated-utility-model.md`

**Current release decision (updated 2026-10-02):** The live source audit and DUK/NEE boundary checks are complete. DUK/SO still lack mapped jurisdiction-level rate-base and allowed-return history in the approved feed, so neither receives a source-ready valuation. Following the approved incomplete-workbook behavior, DUK will receive a formula-driven rate-base DDM workbook with blank required regulatory inputs and no valuation until values and source references are entered. NEE stays unsupported while regulated and unregulated segments are not separated. Consolidated PP&E and earned ROE remain invalid substitutes.

## Live source audit result

The latest DUK filing and the approved Southern Company alternate were checked live. Neither provides the complete current jurisdictional rate-base, authorized-ROE, and allowed-equity-ratio schedule needed by this model through the app's current SEC source path. DUK is now `input_required`; its rate-base DDM contains blank, source-linked entries and no valuation until completed. NEE is classified as mixed regulated/unregulated and remains unsupported until FPL and Energy Resources are separately valued. Consolidated PP&E and achieved ROE are not substituted for regulatory rate base and allowed return.

## Global Constraints

- Support pure regulated operations only; mixed/unregulated holdings remain blocked unless separated by sourced segment data.
- Rate base, allowed ROE, authorized capital structure, capex recovery, regulatory assets/liabilities, and funding costs must be sourced or visibly labeled as analyst assumptions.
- Missing, ambiguous, stale, default, or unsupported inputs block the valuation.
- Forecast, debt, earnings, dividend, and valuation calculations must use visible editable Excel formulas; no balancing plug.
- Use live SEC and market checks only; preserve unrelated dirty worktree changes and do not stage or commit.

## Review Focus

1. **Rate-base scope:** use regulated utility rate base, not consolidated total assets or PP&E as a silent substitute.
2. **Allowed returns:** distinguish allowed ROE from achieved ROE and from allowed overall return on rate base.
3. **Capex recovery and lag:** regulatory approval, construction, depreciation, and rate recovery periods must be explicit.
4. **Capital structure:** debt/equity shares and cost of debt must reconcile to the regulated entity's allowed structure or a labeled analyst base.
5. **Mixed utility exposure:** NEE remains blocked unless FPL and unregulated Energy Resources operations are separately modeled.

---

### Task 1: Map regulated utility history and subtype

**Files:** `backend/app/services/valuation/canonical.py`, `backend/app/api/contracts.py`, `backend/app/services/valuation/classifier.py`, `model/src/core/types/native.ts`, `model/src/api/contracts.ts`, `model/src/services/integration/sec/native-normalizer.ts`, `model/src/cli.live.test.ts`.

**Interfaces:** Produce `canonical_financials.annual[].utility` with typed `rate_base`, `allowed_roe`, `authorized_equity_ratio`, `approved_capex`, `depreciation`, `regulatory_assets`, `regulatory_liabilities`, `debt`, `interest_expense`, `common_equity`, `dividends`, and `diluted_shares` as available. Classify `regulated_utility | mixed_utility | merchant_utility` with per-line readiness.

- [x] Add live DUK and NEE source-readiness checks; DUK is classified regulated and input-required, while NEE remains mixed and unsupported.
- [x] Inspect DUK and alternate SO filings for rate base, allowed ROE, and capital structure. DUK's filing disclosed equity capital structure but not the required jurisdiction-level rate base/authorized return schedule; SO disclosed subsidiary ROEs but not the full rate-base/capital history.
- [ ] Implement source-backed utility mapping only after a filing/regulatory source feed supplies the missing jurisdiction-level inputs. The current feed lacks those inputs, so consolidated PP&E/earned ROE are not substituted.
- [x] Add a live NEE mixed-utility subtype block assertion and DUK missing-source input-workbook test.

### Task 2: Implement rate-base forecasting and equity valuation

**Files:** create `model/src/services/valuation/utility-model.ts`; modify router, model types, normalizer, and the live test file.

**Interfaces:** `mapCanonicalUtilityFinancialsToHistoricals(canonical) -> UtilityHistoricalData`; `calculateUtilityValuation(history, assumptions) -> UtilityModelResult` with `valuationBasis: 'equity'`, no corporate FCFF fields, rate-base and financing schedules, dividends/common equity, and five-year forecast outputs.

- [ ] Add a live DUK/SO calculation test only after source-complete rate-base and allowed-return data is available.
- [ ] Run the test red before implementing the utility engine.
- [ ] Implement explicit rate-base and capital formulas; compute dividends from earnings/allowed payout and keep debt funding visible. Terminal assumptions must be sourced/labeled and terminal growth below cost of equity.
- [ ] Dispatch `utility_rate_base` only for pure regulated subtype with required live sources; keep NEE blocked until segment separation passes.
- [ ] Run focused calculation and full live-only suite.

### Task 3: Export the utility formula workbook

**Files:** create `backend/app/services/excel_export/mappers/utility_model.py`; modify export contracts, `model/src/services/exporters/excel/utility-payload.ts`, `model/src/application/run-valuation-job.ts`, and `model/src/cli.live.test.ts`.

**Interfaces:** `DcfExportPayload.utilityModel` contains canonical history, dated sources, editable model assumptions, and the forecast horizon. The `Utility Model` sheet displays rate-base roll-forward, allowed returns, capex/recovery, debt/equity financing, dividends, valuation, sensitivities, and checks as readable formulas.

- [ ] Add a live utility exporter test only after a supported utility engine can produce a complete, source-backed forecast.
- [ ] Run the test red before adding the mapper.
- [ ] Implement `apply_utility_model`; actuals and forecasts remain distinct, and Python writes no forecast results as values.
- [ ] Recalculate the live workbook with Artifact Tool; confirm no formula errors, expected rate-base/return/cost-of-equity sensitivity directions, and engine parity within 0.1% equity value and $0.01/share.
- [ ] Run the export test, typecheck, Python compilation, and full live-only suite.

### Task 4: Enable only source-ready regulated utilities

- [x] Add live CLI checks that export an input-required workbook for DUK and block mixed-utility NEE without writing a workbook.
- [x] Update README/CLI docs with the current utility block boundary and missing regulatory inputs.
- [ ] Enable only after source, engine, workbook, and recalculation acceptance checks pass.

Task 5 registers the formula engine and workbook for DUK's `input_required` case. The `ready` status remains disabled until a live regulatory source provides the jurisdictional rate base and authorized-return schedule.

### Task 5: Export an input-required rate-base DDM for pure regulated utilities

**Files:** modify `backend/app/services/valuation/classifier.py`, `backend/app/services/valuation/model_eligibility.py`, `backend/app/api/contracts.py`, `backend/app/services/excel_export/mappers/__init__.py`, `model/src/core/types/native.ts`, `model/src/api/contracts.ts`, `model/src/application/run-valuation-job.ts`, `model/src/services/valuation/router.ts`, and `model/src/cli.live.test.ts`; create `model/src/services/valuation/utility-model.ts`, `model/src/services/exporters/excel/utility-payload.ts`, and `backend/app/services/excel_export/mappers/utility_model.py`.

**Interfaces:** The registered `utility_dcf` route supports `input_required` for pure regulated companies while jurisdiction-specific actuals are missing. Its workbook accepts sourced closing rate base, authorized equity percentage, allowed ROE, forecast rate-base additions, depreciation/retirements, and payout assumptions. Formula-based dividends and a common-equity DDM remain blank until required values, source references, and validation constraints pass. NEE's mixed utility subtype remains unsupported.

- [x] Add a live DUK regression for input-required routing and a live NEE regression for the mixed-utility block.
- [x] Run the red live DUK CLI case and inspect its current unsupported behavior.
- [x] Define exact required inputs, periods, units, source-reference requirements, and bounds in the TypeScript and Python contracts.
- [x] Implement a five-year rate-base roll-forward, allowed-equity-earnings schedule, dividend forecast, direct-equity DDM, valuation bridge, and sensitivity in both the calculation engine and native Excel formulas.
- [x] Recalculate a live DUK workbook while blank, invalid, and restored-with-test-input states are exercised; verify no formula errors and that valuation responds to rate-base changes; compare the restored workbook with the independent calculation engine.
- [x] Run the focused DUK/NEE tests, `npm run typecheck`, `python3 -m compileall -q backend/app`, `git diff --check`, and the full live-only suite.

## Execution

Continue inline using `superpowers:executing-plans`; do not delegate, stage, or commit. One pure regulated utility does not establish support for mixed or merchant utilities.
