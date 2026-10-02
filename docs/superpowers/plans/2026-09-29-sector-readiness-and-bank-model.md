# Sector Readiness and Commercial Bank Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Keep incomplete sector routes from producing valuations and deliver a live, source-traceable, formula-driven residual-income model for supported U.S. commercial banks.

**Architecture:** The Python backend canonical mapper is the only SEC concept-selection layer. The TypeScript valuation engine consumes typed canonical history, applies a commercial-bank forecast and residual-income valuation, and returns bank-specific schedules. A dedicated Python Excel mapper writes the same schedules as readable formulas; eligibility remains blocked unless required filing data and dated market inputs are available.

**Tech Stack:** TypeScript 5.7, Vitest live-only suite, Python 3.11, FastAPI/Pydantic, SEC `edgartools`, OpenPyXL, bundled Artifact Tool workbook recalculation.

**Spec:** `docs/superpowers/specs/2026-09-29-company-specific-sector-models-design.md`

## Global Constraints

- The requested output is company-specific, with sector-specific forecasting and valuation logic.
- Workbook assumptions and formulas must be visible and editable; formulas must use clear labels and linked assumptions rather than opaque hardcoded calculations.
- Material historical figures must have source, period, unit, and filing-date traceability.
- Live SEC and market inputs must be used for validation. The user has asked that non-live tests remain removed, so this work will not restore them.
- Preserve the existing dirty worktree and unrelated user changes. Do not reset, stage, or commit changes.
- Do not claim coverage for sectors or company types that have not passed the model's acceptance checks.

## Review Focus

1. **Conflicting SEC concepts and units:** live AAPL checks must compare canonical annual values with their filed source rows and verify that units do not change during normalization (Task 2).
2. **Bank-specific rows and subtypes:** JPM and BAC must map all required commercial-bank drivers; Goldman Sachs must remain blocked as an unsupported investment-bank subtype (Tasks 3 and 6).
3. **Insufficient or ambiguous bank history:** a required bank driver with `missing` or `ambiguous` source status must prevent model eligibility instead of becoming zero or a guessed value (Task 3).
4. **Default market assumptions:** a default or unavailable risk-free rate, equity risk premium, or beta must not produce a supported bank valuation (Task 6).
5. **Formula behavior and parity:** live bank workbooks must recalculate without formula errors, respond to input edits in the expected direction, and match the CLI valuation within the spec's tolerances (Tasks 5 and 6).

---

### Task 1: Block current draft sector valuations

**Files:**
- Modify: `backend/app/services/valuation/classifier.py`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:**
- Consumes: `classify_company(profile, canonical_financials) -> ModelEligibility` and the existing `runValuationJob` eligibility check.
- Produces: live CLI blocks for bank, insurance, REIT, and utility routes until each route has an implemented and validated engine.

- [x] **Step 1: Add a live regression test named `blocks draft sector routes without writing workbooks`.** Run JPM, AIG, PLD, and NEE through the CLI; assert a nonzero result, a sector-specific block reason, and no output file. Keep AAPL's generic DCF case and existing high-growth block case.
- [x] **Step 2: Run the new live test and verify it fails because the current draft routes export workbooks.**

  Run from `model/`:

  ```bash
  EDGAR_IDENTITY="${EDGAR_IDENTITY:?set it before live checks}" npm test -- --reporter=dot -t "blocks draft sector routes"
  ```

  Expected: the four draft-sector assertions fail against current `supported_by_current_engine: true` responses.

- [x] **Step 3: Set `supported_by_current_engine` to `false` for bank, insurance, REIT, and utility classifications in `classify_company`.** Preserve each `preferred_model`, but include one explicit block reason per route:
  - bank: `Commercial bank model is unavailable until forecast, capital, and valuation schedules are complete.`
  - insurance: `Insurance model is unavailable until premium, reserve, capital, and valuation schedules are complete.`
  - REIT: `Equity REIT model is unavailable until property, AFFO, and NAV schedules are complete.`
  - utility: `Regulated utility model is unavailable until rate-base, financing, and valuation schedules are complete.`
- [x] **Step 4: Re-run the focused live test and the complete live-only suite.** Expected: draft routes block without a workbook; supported AAPL and existing live source checks pass.

### Task 2: Make canonical SEC history typed and authoritative

**Files:**
- Modify: `backend/app/services/valuation/canonical.py`
- Modify: `backend/app/api/contracts.py`
- Modify: `model/src/core/types/native.ts`
- Modify: `model/src/api/contracts.ts`
- Modify: `model/src/services/integration/sec/native-normalizer.ts`
- Modify: `model/src/application/run-valuation-job.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:**
- Consumes: SEC native statement rows and the current canonical annual series.
- Produces: `CanonicalFinancialsPayload` with `years`, `annual`, `latest`, `quality`, and typed lines. Each line has `value: number | null`, `source`, `confidence`, `method`, `concept`, and source records containing accession, filing date, fiscal period, currency, and unit when available from SEC. `null` means missing; numeric zero remains a reported or derived zero.
- Produces: `mapCanonicalFinancialsToHistoricals(canonical, market, profile) -> HistoricalData`; generic DCF code no longer selects SEC concepts from raw rows.

- [x] **Step 1: Extend the live AAPL test named `maps canonical operating history to filed SEC rows`.** Assert the latest canonical revenue, net income, common equity, CFO, capex, D&A, cash, debt, shares, and noncontrolling interest against the corresponding live source rows or market source; assert missing/ambiguous are not converted to numeric zero.
- [x] **Step 2: Run that live test and verify it fails on absent canonical fields or untyped/missing source states.**
- [x] **Step 3: Define matching Pydantic and TypeScript types for canonical annual lines and preserve source concept, filing/accession, period, currency, unit scale, and normalization notes.** If statement rows omit filing metadata, resolve it from SEC fact metadata keyed by CIK, concept, and fiscal period; if no exact filing is found, keep the source unresolved and visible instead of guessing.
- [x] **Step 4: Extend `build_canonical_financials` with deterministic preferred-concept selection for every SEC-backed historical field consumed by `buildBaseAssumptions` and `calculateDCF`.** Return `null`/`missing` for absent fields and `ambiguous` when equally preferred concepts disagree.
- [x] **Step 5: Replace raw-row selection in `mapNativeFinancialsToHistoricals` with `mapCanonicalFinancialsToHistoricals`, and call the canonical mapper from `runValuationJob`.** Keep raw SEC rows available only for review and source comparison.
- [x] **Step 6: Re-run the focused live AAPL mapping test, `npm run typecheck`, and the full live-only suite.** Expected: the AAPL historical inputs still match filed data and no TS normalizer independently chooses SEC concepts.

### Task 3: Add canonical commercial-bank historical drivers

**Files:**
- Modify: `backend/app/services/valuation/canonical.py`
- Modify: `backend/app/services/valuation/classifier.py`
- Modify: `backend/app/services/valuation/model_eligibility.py`
- Modify: `backend/app/api/contracts.py`
- Modify: `model/src/core/types/native.ts`
- Modify: `model/src/core/types/model.ts`
- Modify: `model/src/api/contracts.ts`
- Modify: `model/src/services/integration/sec/native-normalizer.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:**
- Consumes: the typed canonical annual contract from Task 2 and live SEC rows for JPM and BAC.
- Produces: `canonical_financials.annual[].bank` with typed lines for `interest_income`, `interest_expense`, `net_interest_income`, `noninterest_income`, `noninterest_expense`, `provision_for_credit_losses`, `loans_and_leases`, `deposits`, `interest_bearing_liabilities`, `interest_earning_assets`, `risk_weighted_assets`, `cet1_capital`, `minimum_cet1_ratio`, `common_equity`, `common_equity_distributions`, and `diluted_shares`.
- Produces: `model_eligibility.subtype: 'commercial_bank' | 'investment_bank' | 'other_financial' | null` and required-input readiness for commercial banks. A bank with unsupported subtype or required `missing`/`ambiguous` lines remains blocked.
- Produces: `BankHistoricalData` in `model/src/core/types/model.ts` and `mapCanonicalBankFinancialsToHistoricals(canonical) -> BankHistoricalData` in `native-normalizer.ts` for the supported commercial-bank subtype. Preserve nullable values and source states until eligibility has confirmed readiness.

- [x] **Step 1: Add a live test named `maps commercial bank drivers from JPM and BAC SEC filings`.** It checks exact FY2025 JPM/BAC statement and filing values, 2023–2024 comparative lines, filing provenance, source units, and the regulatory capital minimum.
- [x] **Step 2: Run the live test and verify it fails because the bank-specific canonical section and subtype readiness are not implemented.** The first run failed on the missing `annual[].bank` contract.
- [x] **Step 3: Inspect the live JPM and BAC annual statement and filing rows to identify exact concept precedence for each required bank line.** Average earning assets/liabilities and regulatory capital requirements come from named 10-K tables; all conversions retain filing accession/date and reported units.
- [x] **Step 4: Implement deterministic bank line mapping in `build_canonical_financials`.** Missing, ambiguous, and unscaled values remain unavailable; parent common equity excludes preferred stock and noncontrolling interest; minimum CET1 requirement is sourced from the standardized/regulatory table.
- [x] **Step 5: Add the `bank_residual_income` model name to backend and TypeScript model unions and export-request validation.** Commercial banks require complete filing and current market readiness; Goldman Sachs remains blocked as an investment bank.
- [x] **Step 6: Re-run the JPM/BAC live mapping test and the full live-only suite.** JPM/BAC source lines, 3-year noninterest/credit comparative data, and subtype boundaries passed in the 14/14 live suite.

### Task 4: Implement the commercial-bank forecast and equity valuation

**Files:**
- Create: `model/src/services/valuation/bank-model.ts`
- Modify: `model/src/services/valuation/router.ts`
- Modify: `model/src/core/types/model.ts`
- Modify: `model/src/services/dcf/engine.ts`
- Modify: `model/src/services/exporters/excel/payload-mappers.ts`
- Modify: `model/src/services/exporters/excel/index.ts`
- Modify: `model/src/application/run-valuation-job.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:**
- Consumes: `BankHistoricalData` assembled from `canonical_financials.annual[].bank` and dated market inputs.
- Consumes: `BankModelAssumptions` with editable earning-asset growth, deposit growth, earning-asset yield, funding cost, noninterest-income growth, efficiency ratio, provision rate, tax rate, payout ratio, minimum CET1 ratio, dated risk-free rate/ERP/beta, terminal growth, and forecast horizon. NIM is calculated from interest income and expense.
- Produces: `calculateBankValuation(historical: BankHistoricalData, assumptions: BankModelAssumptions): BankModelResult`, where `BankModelResult extends DCFResults`, sets `valuationBasis: 'equity'` and `enterpriseValue: null`, and carries five-year `bankForecasts: BankForecastYear[]` without filling corporate FCFF fields with bank values.
- Produces: a residual-income model: common equity value equals opening common equity plus present value of forecast residual income plus present value of terminal residual income. Terminal growth must be below cost of equity.

- [x] **Step 1: Add a live calculation test named `calculates a sourced five-year bank forecast and residual-income valuation`.** The live JPM test reconciles NII, earnings, distributions, common-equity roll-forward, CET1/RWA, residual income, and per-share value; higher cost of equity lowers value and higher asset yield increases value.
- [x] **Step 2: Run the live calculation test and verify it fails because `calculateBankValuation` does not exist.** The new live test initially failed at the missing bank model module.
- [x] **Step 3: Define `BankModelAssumptions`, `BankForecastYear`, and `BankModelResult`; add equity valuation basis and nullable enterprise value; implement `calculateBankValuation` with sourced latest history, required assumptions, and no fallback rates.** The model uses average earning assets/liabilities, a loan-based provision, common-equity roll-forward, and capital-constrained distributions.
- [x] **Step 4: Dispatch `bank_residual_income` from `calculateRoutedValuation`; missing, ambiguous, defaulted, unavailable, or stale inputs fail closed.** Recent cached live market context is accepted only when its source timestamp is within 24 hours; default or stale inputs remain blocked.
- [x] **Step 5: Re-run the focused live bank calculation test and the full live-only suite.** The five-year schedules reconcile and bank enterprise value is null.

### Task 5: Export a formula-driven bank workbook

**Files:**
- Create: `backend/app/services/excel_export/mappers/bank_model.py`
- Modify: `backend/app/services/excel_export/mappers/__init__.py`
- Modify: `backend/app/api/contracts.py`
- Modify: `model/src/services/exporters/excel/types.ts`
- Modify: `model/src/services/exporters/excel/index.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:**
- Consumes: `DcfExportPayload.bankModel` containing typed bank historicals, editable bank assumptions, forecast values, and valuation summary.
- Produces: an Excel workbook with `Bank Model` and `Data Review` sheets. The `Bank Model` sheet separates sourced historicals, editable assumptions, forecast schedules, capital checks, residual-income valuation, and sensitivities.
- Produces: readable formulas for all forecast and valuation calculations; Python supplies sourced actuals and labels, not calculated forecast results as static values.

- [x] **Step 1: Add a live test named `exports an editable formula bank workbook for JPM`.** It checks sourced inputs, blue assumptions, readable formulas, source review, and capital/reconciliation formulas.
- [x] **Step 2: Run the live export test and verify it fails because the bank payload and dedicated mapper are absent.** The test first failed on the missing bank export mapper.
- [x] **Step 3: Add typed `BankModelExportData` and the Python request contract.** The payload carries canonical history and provenance, dated market inputs, assumptions, and assumption source notes; forecast results are formulas in Excel.
- [x] **Step 4: Implement `apply_bank_model(workbook, payload)` and route `bank_residual_income` to it.** The workbook uses visible labels, blue assumption cells, exact source metadata, cashflow/credit/capital formulas, residual income valuation, and a 2D cost-of-equity/terminal-growth sensitivity.
- [x] **Step 5: Recalculate live JPM and BAC workbooks with the bundled Artifact Tool engine.** Both produced zero formula errors; engine parity variance was under 1e-12 relative equity value and under $0.01 per share; yield, funding cost, and cost-of-equity edits moved value in the expected directions; the sensitivity base case equaled the main equity value.
- [x] **Step 6: Re-run the export test, TypeScript typecheck, Python syntax compilation, `git diff --check`, and the full live-only suite.** The live-only suite passed 14/14.

### Task 6: Enable only ready bank issuers and publish the support boundary

**Files:**
- Modify: `backend/app/services/valuation/classifier.py`
- Modify: `model/src/application/run-valuation-job.ts`
- Modify: `model/src/cli.live.test.ts`
- Modify: `README.md`
- Modify: `docs/CLI_ARCHITECTURE.md`

**Interfaces:**
- Consumes: canonical bank readiness, `bank_residual_income` calculation, and the formula workbook mapper from Tasks 3–5.
- Produces: supported CLI export for eligible commercial banks; explicit block for bank issuers missing required source lines, investment-bank subtype, or live valuation inputs. Insurance, REIT, and utility routes remain blocked.

- [x] **Step 1: Add a live end-to-end test named `exports JPM and BAC bank models and blocks unsupported financial subtypes`.** JPM/BAC write `Bank Model` formula workbooks; GS blocks; AIG, PLD, and NEE block without writing workbooks.
- [x] **Step 2: Gate default/unavailable risk-free rate, ERP, and beta; preserve live or recent dated source status in Data Review.** Commercial-bank readiness includes the source and freshness state of market inputs.
- [x] **Step 3: Run the new live tests and verify subtype boundaries.** JPM/BAC pass the complete live path; GS, insurance, REIT, and utility routes remain blocked.
- [x] **Step 4: Enable `bank_residual_income` only when filed bank lines and current dated market inputs pass readiness.** No corporate FCFF/enterprise-value result is used for banks.
- [x] **Step 5: Update README and CLI architecture docs with current bank support, blocked routes, live-data requirements, source-quality behavior, workbook formulas, and current limitations.**
- [x] **Step 6: Run the full live-only suite, TypeScript typecheck, Python syntax compilation, `git diff --check`, and Artifact Tool recalculation on JPM/BAC outputs.** Full live-only suite: 14/14 passed.

## Later model projects

The parent request also requires P&C insurance, equity REIT, and regulated-utility models. Keep these routes blocked and continue with separate reviewed specifications and implementation plans for each; do not treat completion of the bank vertical slice as completion of the parent request. Other sectors remain unsupported until separately modeled.

## Execution choice

Use native implementation in this session. The existing worktree contains unrelated user changes, the bank calculation and workbook interfaces are tightly coupled, and the active constraints rule out optional delegation and commits.
