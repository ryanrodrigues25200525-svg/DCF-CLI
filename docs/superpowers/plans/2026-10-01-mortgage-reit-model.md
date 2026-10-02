# Agency Mortgage REIT Model Implementation Plan

> Continue inline in the current dirty checkout. Use only live EDGAR/market checks in `model/src/cli.live.test.ts`; do not stage, commit, reset, or discard existing changes.

**Goal:** Implement `mortgage_reit_residual_income` for source-ready agency mortgage REITs, starting with AGNC, with separate GAAP/economic schedules and an editable formula workbook.

**Spec:** `docs/superpowers/specs/2026-10-01-mortgage-reit-model.md`

## Global constraints

- Preserve SEC source periods, units, scales, accessions, filing dates, table labels, ownership scope, and reported versus derived status.
- Do not put mortgage REITs through the equity REIT AFFO/NAV model or the corporate FCFF engine.
- Keep GAAP interest income/expense separate from filed economic/TBA/swap interest metrics.
- Keep mark-to-market book-value movement, asset yield, cost of funds, leverage, and dividends visible and editable.
- Keep the route blocked for issuers whose MBS/repo/hedge/book sources are missing, ambiguous, stale, or non-comparable.

### Task 1: Extract live AGNC mortgage-REIT schedules

**Files:** modify `backend/app/services/edgar.py`, `backend/app/api/contracts.py`, `model/src/core/types/native.ts`, and live tests.

- [x] Add live AGNC checks for three-year balance, income, economic asset-yield/cost-of-funds/spread, repo/funding, average leverage, common/preferred book, period-end shares, and dividends.
- [x] Preserve SEC label, period, value, unit/scale, accession, and filing date for each extracted table line; keep unavailable 2022 common shares and preferred preference visibly missing rather than estimated.
- [x] Add a live commercial mortgage-REIT block case and source-completeness assertions.
- [x] Parse the source tables deterministically; missing or non-comparable tables keep issuer readiness false.

### Task 2: Add the canonical mortgage-REIT contract and eligibility gate

**Files:** modify canonical mapping, classifier/readiness, Pydantic/TypeScript models, and SEC normalizer.

- [x] Add typed annual MBS, repo, economic-interest, hedge, leverage, book, dividend, and share facts with GAAP/non-GAAP distinctions.
- [x] Reconcile total assets, liabilities, stockholders’ equity, preferred liquidation preference, period-end shares, and reported net book value; use a separate three-year tangible-book bridge check.
- [x] Require a source-complete three-year history, opening book value, current price/beta/rates, and full preferred/common equity bridge.
- [x] Keep STWD and other commercial mortgage REITs blocked until their credit-mortgage and servicing economics have separate source contracts.

### Task 3: Implement a five-year mortgage REIT residual-income engine

**Files:** create `model/src/services/valuation/mortgage-reit-model.ts` and its assumption policy; modify valuation routing and CLI job orchestration.

- [x] Add live AGNC forecast assertions for investment assets, repo/TBA debt, asset yield, pre-hedge funding cost, swap hedge income, aggregate cost of funds, operating expenses, preferred dividends, common earnings, distribution, book-value roll-forward, residual income, and per-share value.
- [x] Run the live model test red before implementation.
- [x] Forecast the earnings and equity schedules using editable asset, funding, leverage, swap, payout, dividend, and market-value assumptions with linked calculations.
- [x] Verify sensitivity directions for asset yield, funding cost, swap ratio/net pay rate, investment leverage, borrowing leverage, book-value changes, cost of equity, and common share count.

### Task 4: Export an editable formula workbook

**Files:** create a TypeScript payload builder and `backend/app/services/excel_export/mappers/mortgage_reit_model.py`; modify export schemas and mapper dispatch.

- [x] Add a live AGNC workbook test for GAAP/economic separation, formulas, inputs, source register, book/dividend checks, sensitivity, and no broken references.
- [x] Run the exporter assertion red before adding the mapper.
- [x] Implement `Mortgage REIT Model` and `Data Review` with formula-based forecast cells and no static Python forecast results.
- [x] Recalculate with LibreOfficeDev and inspect/edit-test with Artifact Tool; common-equity parity is within 0.1% and per-share parity within $0.01.

### Task 5: Enable source-ready agency mREITs and document scope

- [x] Add live AGNC end-to-end export and commercial-mREIT block tests; blocked cases do not write workbooks.
- [x] Add `mortgage_reit_residual_income` to production registries after Tasks 1–4 passed.
- [x] Update README/CLI architecture docs with agency-only scope and remaining mortgage REIT blocks.

### Task 6: Run the live-only integration suite

- [x] Run focused AGNC checks, TypeScript typecheck, Python compileall, Artifact Tool recalculation, and `git diff --check`.
- [ ] Run the full live-only `npm test` as part of final project verification after the remaining approved company-model families are implemented.
