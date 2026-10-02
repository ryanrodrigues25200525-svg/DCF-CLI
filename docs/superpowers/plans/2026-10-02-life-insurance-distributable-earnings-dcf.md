# Life-Insurance Distributable-Earnings DCF Implementation Plan

> **For agentic workers:** Implement inline with live-only acceptance. Preserve the dirty checkout; do not stage, commit, reset, or discard work.

**Goal:** Route MET and PRU to an issuer-aware, input-required common-equity DCF that values only earnings distributable after statutory capital retention and legal-entity dividend limits.

**Architecture:** Add a life-insurance SEC source contract, normalize MET after-tax adjusted earnings and PRU pre-tax adjusted operating income without merging their definitions, and build a five-year distributable-earnings DCF with editable capital/upstream-dividend schedules. Missing required capital inputs or source references withhold every valuation output; other life insurers remain unsupported until their source adapters pass.

**Tech Stack:** Python/FastAPI and SEC `edgartools` source parsing; TypeScript valuation job and calculation engine; `openpyxl` native formula workbook; LibreOffice recalculation in the live-only Vitest suite.

**Spec:** `docs/superpowers/specs/2026-10-02-life-insurance-distributable-earnings-dcf-design.md`

## Global Constraints

- MET adjusted earnings available to common are after-tax; never tax these values again.
- PRU adjusted operating income is pre-tax; keep the tax conversion editable, source-referenced, and visible.
- Only MET and PRU may route to this first life-insurance model. Other life insurers remain unsupported.
- RBC floors, statutory capital, and permitted dividend capacity retain issuer, entity, jurisdiction, period, and source scope. Never promote an RBC floor or subsidiary dividend cap to an exact consolidated value.
- Use a direct common-equity DCF at cost of equity; do not use enterprise FCFF or subtract insurer operating liabilities as corporate debt.
- Missing/ambiguous earnings scope, tax, capital retention/release, upstream distribution capacity, parent cash reserve/debt, market input, or source reference must withhold value.
- Add only live integration cases to `model/src/cli.live.test.ts`; do not add fixture-only tests.
- Preserve the pre-existing dirty checkout; do not stage or commit.

## Review Focus

- MET's after-tax earnings and PRU's pre-tax earnings must produce the same after-tax forecast definition without double taxation.
- MET segment values and PRU business segments must reconcile to their filed company totals; an omitted or run-off segment cannot silently vanish.
- Statutory capital and dividend constraints differ by entity/jurisdiction; a parent or consolidated amount cannot stand in for a subsidiary limit.
- Negative or zero distributable earnings, a capital release, a dividend cap below earnings, and parent cash below target must not create a false positive distributable cash flow.
- Missing or invalid source rows, growth, tax, capital, share count, WACC, or terminal assumptions must blank outputs without formula errors.

---

### Task 1: Parse MET and PRU life-insurance facts from SEC filings

**Files:**
- Modify `backend/app/services/edgar.py`
- Modify `backend/app/api/contracts.py`
- Modify `model/src/core/types/native.ts`
- Modify `model/src/api/contracts.ts`
- Modify `model/src/cli.live.test.ts`

**Interfaces:**
- Add `life_insurance_filing_facts[]` with `metric`, `segment`, `capital_group`, `fiscal_year`, `value`, `unit`, `unit_scale`, `earnings_basis`, `comparison_operator`, `accession_number`, `filing_date`, `report_date`, `form`, and `source_statement`.
- Parse MET's FY2023–FY2025 adjusted earnings available to common by segment, company-reported RBC ratio floors, and subsidiary dividend limits/payments.
- Parse PRU's FY2023–FY2025 adjusted operating income before income tax by segment, PICA statutory income/capital/surplus, and ordinary-dividend capacity.
- Keep business/segment earnings facts separate from statutory-capital and distribution facts.

- [x] Write a live source mapping test for both latest 10-K accessions; run it red.
- [x] Parse repeated year tables without confusing 2025/2024/2023 rows or mixing year-specific source text.
- [x] Preserve each issuer's reported earnings basis and legal-entity/jurisdiction scope.
- [x] Verify an unsupported life-insurer source contract does not claim a complete life-insurance source set.

### Task 2: Add life-insurer readiness and input-required routing

**Files:**
- Modify `backend/app/services/valuation/classifier.py`
- Modify `model/src/core/types/native.ts`
- Modify `model/src/services/valuation/router.ts`
- Modify `model/src/application/run-valuation-job.ts`
- Modify `model/src/cli.live.test.ts`

**Interfaces:**
- Production route: `life_insurer_distributable_earnings_dcf`.
- Route MET/PRU to `input_required` only when the earnings source map and current common-equity market context pass. Create separate missing-input gaps for tax conversion, earnings forecasts, statutory-capital retention, permitted upstream dividends, parent cash reserve/debt, WACC, and terminal growth.
- Keep P&C insurers on `insurance_pnc_residual_income`; all other life insurers stay `unsupported` until their own source maps pass.

- [x] Write live MET/PRU classifier boundary tests and run them red.
- [x] Enable only the new life-insurer route after source facts, payload validation, engine, and mapper are registered.
- [x] Confirm unsupported insurers and P&C AIG routing remain unchanged.

### Task 3: Define life-insurance payload and distributable-earnings engine

**Files:**
- Create `model/src/services/valuation/life-insurance-model.ts`
- Create `model/src/services/exporters/excel/life-insurance-payload.ts`
- Create `model/src/services/exporters/excel/life-insurance-payload.ts`
- Modify `model/src/services/exporters/excel/types.ts`
- Modify `model/src/api/contracts.ts`
- Modify `backend/app/api/contracts.py`
- Modify `model/src/application/run-valuation-job.ts`
- Modify `model/src/cli.live.test.ts`

**Interfaces:**
- Export `LifeInsuranceSegmentFact`, `LifeInsuranceCapitalSchedule`, `LifeInsuranceForecastAssumptions`, and `LifeInsuranceDcfAssumptions` types.
- Export `calculateLifeInsuranceDistributableEarnings(assumptions)` returning issuer-normalized segment earnings, five-year after-tax earnings, company-level net statutory-capital additions/releases, upstream caps, distributable equity cash flows, cost of equity, equity value, and per-share value.
- For each forecast period: `cashAvailable = afterTaxAdjustedEarnings - netCapitalAddition`; if `cashAvailable < 0`, distributable earnings remain negative; otherwise cap it at the source-referenced, company-level aggregate upstream dividend capacity. Legal-entity source facts remain visible and are reconciled in the aggregate input's source note; no hidden entity mapping is assumed.
- `terminalValue = terminalYearDistributableEarnings × (1 + terminalGrowth) ÷ (costOfEquity − terminalGrowth)`; require positive terminal-year distributable earnings and terminal growth at least 50 bps below cost of equity.

- [x] Write live engine parity assertions from MET/PRU SEC-derived facts plus explicit test-only assumptions and run them red.
- [x] Validate the MET/PRU earnings bases, 5-year periods, source provenance, aggregate capital input scope, input ranges, unique segment keys, and missing/negative states.
- [x] Verify parent cash/debt uses only holding-company values or an explicit required input; do not use consolidated operating assets as excess cash.
- [x] Test capital addition, capital release, upstream limit, negative distributable earnings, tax conversion, and terminal-growth constraints.

### Task 4: Build the editable Excel life-insurance model

**Files:**
- Modify `backend/app/services/excel_export/mappers/__init__.py`
- Modify `backend/app/api/contracts.py`
- Create `backend/app/services/excel_export/mappers/life_insurance_model.py`
- Modify `model/src/cli.live.test.ts`

**Interfaces:**
- Incomplete payload: `lifeInsuranceModel` with issuer-specific actual earnings and capital facts, missing input manifest, dated market data, currency, and unit scale.
- Sheets: `Life Insurance Model`, `Input Required`, `Data Review`.
- The model sheet shows source actuals, the issuer's earnings definition, after-tax forecast, statutory capital/distribution schedule, distributable-earnings DCF, parent-level cash/claims bridge, per-share valuation, and cost-of-equity/terminal-growth sensitivity.

- [x] Write live MET/PRU incomplete CLI export assertions and run them red.
- [x] Add blue/unlocked source-required inputs and visible source-basis notes; formulas remain editable and readable.
- [x] Recalculate original blank, invalid, restored, and formula-edited copies in LibreOffice; verify no formula errors and all gated outputs blank before readiness.
- [x] Verify sensitivity center equals base per-share value and that lower upstream capacity/greater retention reduces value.
- [x] Reconcile restored workbook equity and per-share outputs to the TypeScript engine within 0.1% and $0.01/share.

### Task 5: Verify the life route and update coverage docs

- [x] Run focused MET/PRU live checks, typecheck, Python compileall, `git diff --check`, and targeted Ruff correctness checks.
- [x] Run the full live-only `npm test` suite: 79/79 passed in 15m02s on 2026-10-02.
- [x] Update README, backend/CLI model support boundaries, changelog, and the broad coverage plan; other life insurers remain explicitly unsupported.
- [x] Preserve the Finance Knowledge Graph source audit and add no credentials or personal data.
- [x] Inspect the life-insurance implementation and support-boundary documentation; preserve pre-existing dirty files and do not stage or commit.
