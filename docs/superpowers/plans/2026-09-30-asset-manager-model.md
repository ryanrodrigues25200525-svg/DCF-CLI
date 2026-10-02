# Traditional Asset Manager Model Implementation Plan

> Implement inline in the current dirty checkout. Do not delegate, stage, commit, reset, or discard existing work.

**Goal:** Add a source-backed AUM and fee driven valuation for U.S.-listed traditional asset managers while keeping alternative managers and source-incomplete issuers blocked.

**Architecture:** SEC 10-K text extraction provides filed year-end AUM and disclosed fee revenue components that are missing from standard company facts. The TypeScript engine builds AUM, fee revenue, FCFF, and equity value. The Excel mapper exports the same schedule as readable formulas with explicit source/assumption inputs. The classifier exposes the route only when every required source, market input, and formula adapter is ready.

**Spec:** `docs/superpowers/specs/2026-09-30-asset-manager-model.md`

## Global constraints

- Use only live SEC, current market, and curated peer data in acceptance tests. Add no fixtures or offline-only tests.
- Preserve SEC accession, filing date, fiscal year, units, scale, and the table/statement label for each extracted value.
- Do not infer AUM or revenue from a market cap, generic SIC peer, or stale/guessed rate. Missing values remain missing and block the model if required.
- Keep AUM growth, net flows, market returns, acquisition/FX, fee yield, and performance fee assumptions separate and editable.
- Retain existing bank, insurance, REIT, operating DCF, and trading-comparable routes.
- Keep alternative managers blocked until carry, principal investment, and GP commitment economics have a separate model.
- Preserve the existing dirty checkout; do not stage or commit.

## Review focus

- **Period and unit integrity:** AUM tables may report five annual observations while fee statements report only three. Align each observation by fiscal year and display AUM and currency in consistent units.
- **AUM roll-forward:** Do not add market return, net flows, and acquisitions as independent full-revenue growth rates. Each amount must reconcile to ending AUM exactly once.
- **Fee yield:** Calculate base advisory-fee yield on average AUM, not ending AUM. Keep performance fees and technology revenue separate where filings disclose them.
- **Issuer boundaries:** SIC 6211/6282 includes different financial businesses. Route from issuer description and filed AUM/fee evidence; do not classify every investment company as a traditional asset manager.
- **Formula parity:** The workbook must calculate the same forecast and common-equity value as the engine. No forecast result is written as a fixed value.

---

### Task 1: Add live SEC filing-fact extraction

**Files:** modify `backend/app/services/edgar.py`, `backend/app/models/schemas.py`, `backend/app/api/contracts.py`, and live assertions in `model/src/cli.live.test.ts`.

**Interfaces:** The unified company payload carries annual `asset_management_filing_facts` with concept, value, unit, scale, period, accession, filing date, form, primary document, and source-table label.

- [x] Add live BLK and TROW mapping assertions for at least three year-end AUM values and three years of recurring/performance fee revenue. Verify each extracted row against its 10-K table.
- [x] Run the live mapping checks red while the financial-institution path returns only unsupported `other_financial` classification.
- [x] Parse the SEC 10-K AUM table/annual change disclosures and the consolidated fee-revenue lines. Derive a prior AUM only from a reported current AUM and reported annual change, retaining both source records and the calculation method.
- [x] Preserve unavailable lines and ambiguous table matches as missing; do not create AUM values from quarterly market capitalization or investment returns.
- [x] Re-run BLK and TROW live mapping checks and verify fiscal-year, units, scale, accession, filed date, and table lineage.

### Task 2: Define and validate the asset-manager source contract

**Files:** modify `backend/app/api/contracts.py`, `backend/app/services/valuation/canonical.py`, `backend/app/services/valuation/model_eligibility.py`, and `model/src/core/types/native.ts`.

**Interfaces:** `asset_manager_aum_dcf` receives three or more aligned annual observations for AUM, advisory fees, performance fees, and the operating statement/bridge inputs. BLK/TROW are traditional-manager candidates; BX/KKR remain blocked as alternative managers.

- [x] Add a live BLK/TROW classification test and a live BX/KKR alternative-manager block test.
- [x] Run the tests red against `other_financial` or a generic DCF route.
- [x] Add typed canonical asset-manager history with live SEC provenance and derived average-AUM fee yield.
- [x] Validate units, fiscal-year alignment, signs, required filings, current market data, and the common-equity bridge at the API boundary.
- [x] Re-run the live type/readiness checks; source-incomplete issuers must have no allowed model.

### Task 3: Implement the AUM and fee forecast engine

**Files:** create `model/src/services/valuation/asset-manager-model.ts` and `model/src/services/valuation/asset-manager-assumption-policy.ts`; modify `model/src/core/types/model.ts`, `model/src/services/valuation/router.ts`, `model/src/application/run-valuation-job.ts`, and live tests.

**Interfaces:** The engine returns five annual forecasts with beginning AUM, market change, net flows, acquisition/FX changes, ending/average AUM, fee yields/revenue, performance/technology revenue, operating costs, taxes, FCFF, discount factors, enterprise value, common-equity value, diluted shares, and per-share value.

- [x] Add live BLK and TROW engine assertions for AUM roll-forward identity, average AUM, base-fee yield, revenue, FCFF, enterprise/equity bridge, and per-share value.
- [x] Run the engine test red before adding the calculation route.
- [x] Forecast AUM from editable market-return, net-flow, and acquisition/FX drivers; calculate average AUM from beginning and ending AUM.
- [x] Forecast base advisory fees from average AUM times an editable filed-history fee yield. Forecast performance, securities-lending, technology, and other revenue separately when mapped.
- [x] Calculate the five-year FCFF forecast and a dated-WACC valuation with terminal growth below WACC. Missing fee or bridge inputs block the calculation.
- [x] Test that higher AUM flows, fee yield, and operating margin increase value; higher WACC and share count reduce per-share value.
- [x] Re-run the live BLK and TROW engine cases and verify all forecast identities.

### Task 4: Export an editable formula workbook

**Files:** modify `model/src/services/exporters/excel/types.ts`, `model/src/services/exporters/excel/asset-manager-payload.ts`, `model/src/application/run-valuation-job.ts`, `backend/app/api/contracts.py`, `backend/app/services/excel_export/mappers/__init__.py`; create `backend/app/services/excel_export/mappers/asset_manager_model.py`.

**Interfaces:** The `Asset Manager Model` workbook contains a filed history/source area, AUM roll-forward, fee build, operating forecast, FCFF valuation, diluted per-share value, sensitivities, and formula-linked checks. The Python mapper writes actuals and source metadata as inputs but writes no forecast or valuation result as a fixed value.

- [x] Add a live workbook assertion for AUM/fee actuals, blue editable assumptions, formula links, SEC source register, no broken references, and a visible per-share bridge.
- [x] Run the export assertion red before adding the mapper.
- [x] Implement the asset-manager payload and formula workbook with readable cell references and consistent units.
- [x] Verify there is no generic corporate DCF sheet substituted for the AUM build.
- [x] Re-run the live BLK and TROW workbook export checks.

### Task 5: Enable only source-ready traditional asset managers

**Files:** modify `backend/app/services/valuation/classifier.py`, `backend/app/services/valuation/model_eligibility.py`, `backend/app/api/contracts.py`, `model/src/core/types/native.ts`, `model/src/services/valuation/router.ts`, and `model/src/cli.live.test.ts`.

- [x] Add live BLK and TROW end-to-end CLI exports and a live BX alternative-manager block case.
- [x] Run the end-to-end and block tests red.
- [x] Add `asset_manager_aum_dcf` to production calculation/export registries and classify only the supported traditional-manager subtype.
- [x] Keep every unsupported subtype blocked before workbook creation.
- [x] Re-run live CLI tests and update README/CLI architecture docs with exact supported scope and limits.

### Task 6: Recalculate and verify the live workbook

- [x] Recalculate live BLK and TROW workbooks with LibreOfficeDev and Artifact Tool; find no formula errors.
- [x] Compare engine and workbook equity value within 0.1% and per-share value within $0.01.
- [x] Edit AUM market return, net flows, fee yield, margin, WACC, terminal growth, debt, and diluted shares; verify expected output direction and that restoring inputs returns the original result. Recalculate the 2D WACC/terminal-growth grid and confirm its center ties to per-share value.
- [x] Run the entire live-only CLI suite, TypeScript typecheck, Python compilation, and `git diff --check`; the 2026-10-01 suite passed 50/50 live tests.

## Execution

Continue inline. Preserve existing user changes. Do not stage or commit.
