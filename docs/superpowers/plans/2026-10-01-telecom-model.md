# U.S. Wireless Telecom Operator Model Implementation Plan

> Continue inline in the current dirty checkout. Run only live-source checks in `model/src/cli.live.test.ts`; do not stage, commit, reset, or discard existing changes.

**Goal:** Implement `telecom_subscriber_dcf` for source-ready U.S. integrated wireless operators, starting with AT&T, with an editable formula workbook and fail-closed issuer routing.

**Spec:** `docs/superpowers/specs/2026-10-01-telecom-model.md`

## Global constraints

- Use live SEC filings and live dated market inputs; do not add fixture-only or mock-only tests.
- Preserve fiscal year, source concepts, 10-K accession, filed date, units, scale, and table label.
- Do not infer disclosed churn, subscriber, broadband, or segment values from market data.
- Unsupported telecom subtypes remain blocked before calculation/export.
- Forecasts remain readable editable Excel formulas; Python writes sourced actuals and labels only.
- Preserve the existing dirty checkout and user changes.

### Task 1: Extract telecom operating tables from live 10-Ks

**Files:** modify `backend/app/services/edgar.py`, `backend/app/models/schemas.py`, `backend/app/api/contracts.py`, and `model/src/cli.live.test.ts`.

- [x] Add live AT&T assertions for FY2023–FY2025 wireless customers, net additions, churn, segment service/equipment revenue, segment EBIT, fiber/broadband customers, network CapEx, debt, debt cost, and working capital with source metadata.
- [x] Add live Verizon source-readiness assertions; its separate Consumer/Business and customer definitions remain unmapped in the AT&T source contract and block before workbook creation.
- [x] Run the new AT&T extraction case red against the absent telecom contract.
- [x] Implement a deterministic AT&T filing-text parser for subscriber, churn, segment, debt, CapEx, and working-capital tables. Missing and non-comparable lines remain missing.
- [x] Re-run live SEC value/provenance checks and require exact fiscal-year/unit alignment. The FY2024 comparative broadband table omits a comparable FY2022 connection count; the parser leaves it missing instead of reading a growth rate as a customer balance.

### Task 2: Build the typed canonical model contract and eligibility gate

**Files:** modify `backend/app/services/valuation/canonical.py`, `backend/app/services/valuation/classifier.py`, `backend/app/services/valuation/model_eligibility.py`, `backend/app/api/contracts.py`, `model/src/core/types/native.ts`, and `model/src/services/integration/sec/native-normalizer.ts`.

- [x] Add canonical annual telecom operating facts with source and derived methods.
- [x] Require three aligned years of subscriber, churn, service-revenue, segment earnings, CapEx, working capital, interest-bearing debt, and common-equity-bridge inputs.
- [x] Classify telecom operators independently from generic positive-EBIT companies; list only the production subscriber DCF route in `allowed_models`.
- [x] Keep Verizon or other operators blocked when its source layout and customer definitions do not pass the AT&T source contract.

### Task 3: Implement the subscriber and segment DCF engine

**Files:** create `model/src/services/valuation/telecom-model.ts` and `model/src/services/valuation/telecom-assumption-policy.ts`; modify model types, router, job orchestration, and live tests.

- [x] Add live AT&T forecast assertions for wireless and broadband roll-forwards, derived monthly revenue per customer, segment revenue/EBIT, consolidated revenue tie-out, FCFF, WACC, common-equity bridge, and per-share value.
- [x] Run the live calculation test red before adding the route.
- [x] Forecast customer balances using beginning customers, editable gross additions, and filed churn with an explicit average-customer calculation.
- [x] Keep wireless service, equipment, broadband, declining wireline, enterprise, Latin America, and residual revenue separate.
- [x] Forecast operating margins, taxes, D&A, network CapEx, working capital, FCFF, terminal value, and common equity from sourced history and labeled editable assumptions.
- [x] Verify expected value direction under customer additions/churn, ARPU, margins, CapEx, WACC, terminal growth, debt bridge at fixed WACC, and share-count changes.

### Task 4: Export an editable telecom formula workbook

**Files:** add a TypeScript payload builder and `backend/app/services/excel_export/mappers/telecom_model.py`; modify export types/contracts and mapper routing.

- [x] Add a live AT&T workbook test for blue assumptions, formulas, customer/revenue checks, source register, visible common-equity bridge, and no broken references.
- [x] Run the export assertion red before adding the mapper.
- [x] Implement `Telecom Model` and `Data Review` sheets with formulas for forecast cells and no fixed forecast values.
- [x] Recalculate and edit-test the workbook with LibreOfficeDev and Artifact Tool.

### Task 5: Enable source-ready issuers and publish limits

- [x] Add a live end-to-end AT&T export and an unsupported/source-incomplete Verizon block case; confirm blocked cases do not write workbooks.
- [x] Add `telecom_subscriber_dcf` to production calculation and export registries after Tasks 1–4 passed.
- [x] Update README and CLI architecture docs with the tested telecom route, exact scope, FY2025 base-period limit, and blocked Verizon subtype.

### Task 6: Verify telecom and full live-only suite

- [x] Compare engine and recalculated workbook equity values within 0.1% and per-share values within $0.01; inspect formulas and sensitivity center.
- [x] Run live telecom cases, full `npm test` live-only suite, `npm run typecheck`, `python3 -m compileall -q app`, and `git diff --check`. The live-only suite passed 50/50 on 2026-10-01.
