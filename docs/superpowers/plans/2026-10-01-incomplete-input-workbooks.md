# Incomplete-Input Workbooks Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan inline. Do not delegate. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every implemented model family export a fillable, formula-driven workbook when the company is classified but required source inputs are missing, while withholding valuation outputs until the required inputs are complete.

**Architecture:** Python remains the authority for model-family routing and SEC readiness, but route availability is separated from valuation readiness. The TypeScript job calculates only ready models and builds an incomplete payload for an implemented route with missing inputs. The Python Excel adapter uses family-specific blank input cells and formula guards, plus a structured `Data Review` register. Unsupported model families still produce no workbook.

**Tech Stack:** Python 3.11, FastAPI/Pydantic, TypeScript, Vitest live-only CLI integration suite, OpenPyXL, bundled LibreOfficeDev.

**Spec:** `docs/superpowers/specs/2026-10-01-incomplete-input-workbooks-design.md`

## Global Constraints

- Use only the live integration suite in `model/src/cli.live.test.ts`; do not add fixture-only or mocked provider tests.
- Incomplete-path fault injection must start from a live issuer response and redact a specific required input in memory; it must not substitute a saved financial fixture or mock a provider.
- Keep SEC source period, concept, accession, filing date, currency, unit, scale, and derivation metadata.
- Never convert a missing required input into zero, a stale market value, or an unexplained assumption.
- Never call a valuation engine or report a market-cap proxy as a model valuation when required inputs are missing.
- Preserve every pre-existing dirty or untracked workspace file. Do not reset, stage, commit, install tools, or overwrite existing user workbooks.
- A production route requires both a calculation engine and a matching formula-workbook adapter. Do not fall through to generic DCF for a specialist subtype.

## Review Focus

- **Missing versus zero:** missing filed values must appear as blank editable inputs, while filed zero and not-applicable remain distinct. Test in Tasks 1, 3, and 4.
- **Route versus readiness:** an implemented family with missing data exports an incomplete model; an unimplemented family writes no workbook. Test in Tasks 1, 2, and 14.
- **No false value:** an incomplete model shows status and blank valuation outputs, never market capitalization or a cached value as intrinsic value. Test in Tasks 2–4.
- **Formula recovery:** filling the identified input cell recalculates the forecast and valuation without editing or re-running application code. Test in Tasks 4–13.
- **Specialist integrity:** banks, insurers, REITs, and other specialist types keep their own valuation method and cannot enter generic FCFF through the incomplete path. Test in Tasks 5–12.

---

### Task 1: Separate model-family availability from source readiness

**Files:**
- Modify: `backend/app/services/valuation/model_eligibility.py`
- Modify: `backend/app/services/valuation/classifier.py`
- Modify: `model/src/core/types/native.ts`
- Modify: `model/src/api/contracts.ts`
- Test: `model/src/cli.live.test.ts`

**Interfaces:**
- Add `ModelBuildStatus = 'ready' | 'input_required' | 'unsupported'` to the Python and TypeScript API contracts.
- Add `ModelReadinessGap` with `key`, `label`, and `reason`; a gap key names a failed classifier readiness check, not an Excel cell.
- Add `status`, `model_route_available`, and `missing_input_gaps: ModelReadinessGap[]` to `ModelEligibility`.
- `status` is `unsupported` only when no production calculation and workbook route exists; `input_required` means the family exists but one or more required fields are unavailable; `ready` means the required source and current-market inputs are usable.
- Keep `required_input_readiness` as the field-level boolean map. Add `model_route_available` to separate route implementation from data readiness. Make `allowed_models` list the production route for both `ready` and `input_required`. Keep `supported_by_current_engine` false for `input_required` so old consumers remain fail-closed; migrate the CLI to use `status` as the state authority.
- Use one `missing_input_gaps` entry per failed readiness check. The model-family exporter expands those aggregate checks into exact per-field, per-period `WorkbookInputRequirement` records; never write an aggregate readiness key into a workbook as if it were a source cell.

- [x] Add a live classifier assertion for AAPL ready, DUK unsupported, and VZ when its live telecom source contract reports missing subscriber history. Assert route ID, status, readiness-gap key, and specific reason.
- [x] Run the focused live classification checks to establish the current contract behavior.
- [x] Update `ModelEligibility` validation so invalid combinations fail: `ready` requires an implemented allowed route and no gaps; `input_required` requires an implemented allowed route and at least one gap; `unsupported` cannot claim an implemented or allowed production route. Preserve `supported_by_current_engine == (status == 'ready')` during migration.
- [x] Derive `missing_input_gaps` from false entries in the existing readiness map and preserve subtype-specific unsupported blocks. The telecom family must retain the `three_year_wireless_subscribers` gap and be marked `input_required` because its model route exists.
- [x] Extend `parseModelEligibility` to validate status and every `ModelReadinessGap`, including rejecting a missing key, label, or reason.
- [x] Re-run the live classifier checks and TypeScript typecheck.

### Task 2: Carry incomplete status through the CLI job and export contract

**Files:**
- Modify: `model/src/application/run-valuation-job.ts`
- Modify: `model/src/services/exporters/excel/types.ts`
- Modify: `model/src/services/exporters/excel/index.ts`
- Modify: `model/src/api/contracts.ts`
- Modify: `backend/app/api/contracts.py`
- Modify: `model/src/services/cli-preflight.ts`
- Modify: `backend/app/services/excel_export/exporter/core.py`
- Modify: `backend/app/services/excel_export/mappers/__init__.py`
- Create: `backend/app/services/excel_export/mappers/incomplete.py`
- Test: `model/src/cli.live.test.ts`

**Interfaces:**
- Define `WorkbookInputRequirement` with exact `key`, `label`, `inputType`, `sourceStatus`, `reason`, period, unit, and source-reference requirement. Keep `DcfExportPayload` as the complete ready payload and define `DcfWorkbookPayload = DcfExportPayload | IncompleteDcfExportPayload`; the incomplete variant permits absent market, WACC, assumptions, and forecast values but requires company/model identity, canonical provenance, and an exact input manifest.
- Add `buildIncompleteExportPayload(data, profile, historicals, model) -> IncompleteDcfExportPayload`. For each mapped gap it records the exact unavailable canonical field and period, preserves source-backed values and explicit nulls, and does not invent assumptions, forecasts, or valuation summaries.
- Change `ValuationJobResult` to a discriminated ready/incomplete union. The ready variant carries `results: DCFResults`; the incomplete variant carries `results: null`, the missing-input list, export payload, and workbook bytes.
- The Pydantic `DcfExportRequest` is a validated superset with `buildStatus`; its validator applies complete-field requirements only to `ready`. Missing market, WACC, tax, and forecast numbers are permitted only for `input_required`; company/model identity, canonical provenance, and the exact workbook-input manifest remain mandatory.
- `formatValuationJobSuccess` prints the workbook path and, for `input_required`, prints each missing label and reason without an implied price or upside.
- Task 2's exporter creates a non-valuative `Input Required` workbook shell so the end-to-end job can succeed; Tasks 3–13 replace it with the full register and model-family schedule before delivery.

- [x] Add a live AAPL job check using its current SEC response, then redact FY2025 CapEx in an in-memory copy and mark that field missing. Assert the job returns `input_required`, still exports a workbook, and has no valuation result.
- [x] Retain the existing live MRNA CLI regression asserting an unsupported model exits nonzero and creates no workbook; it already covers this contract.
- [x] Run the focused live job and inspect the previous complete-only gate; source, identity, and formula invariants remain validated at the appropriate route/export boundary.
- [x] Refactor the job's state handling: `ready` follows the existing engine path; `input_required` maps profile/history with nullable required fields and skips all valuation and sensitivity calculations; `unsupported` retains the current clear error.
- [x] Add `buildStatus` and the structured input requirements to the export payload. Remove the incomplete-path requirement for pre-calculated forecasts while retaining the existing complete-path validation.
- [x] Relax only the export fields that are legitimately missing in an incomplete workbook; keep malformed identity, units, source records, non-finite numbers, and unsupported model IDs as errors.
- [x] Update the CLI output formatter for the incomplete success case.
- [x] Re-run the focused live cases and `npm run typecheck` from `model/`.

### Task 3: Add the shared missing-input register and workbook status

**Files:**
- Modify: `backend/app/services/excel_export/mappers/incomplete.py`
- Modify: `backend/app/services/excel_export/mappers/review.py`
- Modify: `backend/app/services/excel_export/mappers/__init__.py`
- Modify: `backend/app/services/excel_export/mappers/utils/excel.py`
- Test: `model/src/cli.live.test.ts`

**Interfaces:**
- `apply_incomplete_input_register(workbook, requirements, input_cells) -> None` accepts structured required-input records and family-specific `{key: {sheet, cell}}` destinations.
- Each missing cell has a visible label, period, unit, reason, and blue input styling. The `Data Review` register reports field key, status, reason, source state, destination cell, and whether a source reference is required.
- Historical facts entered manually include a paired editable source/reference field in `Data Review`; a model cannot switch to `READY` if a required reported fact has no source reference. Analyst assumptions are labeled as such rather than presented as filed facts.
- Add family-level entry validation. The workbook status displays `INCOMPLETE — fill required inputs` while any required cell is blank, `INPUT ERROR — check required inputs` when any required entry is invalid, and `READY` only when all required entries pass validation.

- [x] Extend the live redacted-AAPL workbook inspection to assert the missing CapEx cell is blank, blue, unlocked, and referenced from `Data Review`; assert the workbook-level status is `INCOMPLETE`.
- [x] Run the focused live export and inspect the current Data Review layout and workbook cell protection settings.
- [x] Implement a shared register mapper that preserves missing, zero, not-applicable, and analyst-entered as separate states and returns actionable cell locations.
- [x] Add status formulas that check the declared required cells without generating `#N/A`, `#VALUE!`, or divide-by-zero errors.
- [x] Ensure the incomplete exporter never maps an incomplete payload through the complete DCF template accidentally.
- [x] Re-run the focused live workbook inspection.

### Task 4: Generate an incomplete standard operating DCF workbook

**Files:**
- Modify: `backend/app/services/excel_export/mappers/dcf.py`
- Modify: `backend/app/services/excel_export/mappers/data.py`
- Modify: `backend/app/services/excel_export/mappers/__init__.py`
- Modify: `backend/app/services/excel_export/mappers/incomplete.py`
- Modify: `backend/app/services/excel_export/exporter/core.py`
- Modify: `model/src/application/run-valuation-job.ts`
- Modify: `model/src/services/valuation/operating-model.ts`
- Modify: `model/src/services/exporters/excel/types.ts`
- Modify: `model/src/services/exporters/excel/payload-mappers.ts`
- Test: `model/src/cli.live.test.ts`

**Interfaces:**
- Add `apply_incomplete_operating_dcf(workbook, payload, input_cells, timeline_years, historical_years) -> None` for `unlevered_dcf` only.
- Required historical cells map from canonical field key plus fiscal year; the incomplete mapper receives a destination for each missing required field and does not receive calculated valuation results. Source-backed operating assumptions are preserved; the CapEx forecast driver is a native Excel formula derived from the filed historical series after the missing actual is supplied.
- All forecast, terminal value, enterprise value, equity value, per-share, and sensitivity formulas are guarded by the workbook status cell and return `""` until ready and all required entries pass validation.

- [x] Add the live redacted-AAPL test: generate the workbook with FY2025 CapEx absent, confirm forecast/valuation outputs are blank and formula-error scan is clear.
- [x] Fill the missing CapEx cell and its source reference in a copied workbook with the live FY2025 source value and accession; recalculate with LibreOfficeDev and assert the output populates and ties to the complete live AAPL workbook within 0.1% equity and $0.01 per share.
- [x] Enter a negative CapEx value in the same recalculation flow and assert `INPUT ERROR` with blank valuation outputs; restore the live non-negative value and assert `READY` with populated outputs.
- [x] Run the focused live AAPL ready and incomplete cases before changing the mapper.
- [x] Implement the incomplete operating schedule using the existing model sheet, preserving live sourced history and leaving only the missing actual in a blue cell. Do not populate the forecast from TypeScript numeric results.
- [x] Guard dependent forecast, WACC/terminal value, equity bridge, per-share value, and sensitivity outputs using the visible readiness cell.
- [x] Recalculate both workbooks with LibreOfficeDev; inspect formulas, cell edits, sheet protection, and model status.

### Task 5: Generate incomplete commercial-bank workbooks

**Files:**
- Modify: `backend/app/services/excel_export/mappers/bank_model.py`
- Modify: `backend/app/services/excel_export/mappers/__init__.py`
- Modify: `backend/app/services/excel_export/mappers/incomplete.py`
- Modify: `backend/app/api/contracts.py`
- Modify: `model/src/application/run-valuation-job.ts`
- Modify: `model/src/services/valuation/bank-assumption-policy.ts`
- Modify: `model/src/services/valuation/bank-model.ts`
- Modify: `model/src/services/exporters/excel/types.ts`
- Modify: `model/src/api/contracts.ts`
- Modify: `model/src/services/exporters/excel/bank-payload.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:** The incomplete bank mapper receives bank-family history with explicit null lines and a typed incomplete assumption payload. A missing filed CET1 floor maps to a blue required-input cell; the forecast, capital roll-forward, residual income, equity value, and per-share value remain formulas but are guarded until ready. It keeps common-equity residual income and reports no EV or FCFF valuation.

- [x] Add a live JPM redaction check for `minimum_cet1_ratio`. Assert an incomplete bank workbook, a blank blue CET1 input, no equity/per-share result, and a Data Review source entry.
- [x] Run the live JPM case and record the cell location and residual-income formula dependencies.
- [x] Adapt the bank mapper to place the missing value in that cell and guard the forecast, capital roll-forward, residual income, equity value, and per-share value.
- [x] Fill the input with the original live value, recalculate with LibreOfficeDev, and compare the workbook result with the complete live JPM model.

### Task 6: Generate incomplete P&C-insurance workbooks

**Files:**
- Modify: `backend/app/services/excel_export/mappers/insurance_model.py`
- Modify: `model/src/services/exporters/excel/insurance-payload.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:** The incomplete P&C mapper preserves underwriting and reserve-rollforward schedules and the common-equity residual-income method.

- [x] Add a live AIG redaction check for `unpaid_loss_reserves`. Assert the missing reserve is blank, the reserve check and valuation are blank, and the missing input is listed with the correct filing period.
- [x] Run the live AIG case and locate the reserve input and all dependent cells.
- [x] Add the editable reserve input and guard the reserve schedule, forecast earnings, distributions, and equity valuation until valid.
- [x] Fill the input with its original live value, recalculate, and compare with the complete live AIG workbook.

### Task 7: Generate incomplete equity-REIT workbooks

**Files:**
- Modify: `backend/app/services/excel_export/mappers/reit_model.py`
- Modify: `model/src/services/exporters/excel/reit-payload.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:** The incomplete equity-REIT mapper preserves the AFFO DCF and property NAV cross-check; it does not use generic FCFF.

- [x] Add a live PLD redaction check for `same_store_noi_growth`. Assert a blank blue input, blank dependent forecasts and valuation, and the correct Data Review location.
- [x] Run the live PLD case and identify forecast growth, AFFO, NAV, and sensitivity formulas that depend on this input.
- [x] Guard those formulas and add an editable source/reference field for the analyst-supplied value.
- [x] Restore the live value, recalculate, and compare the result with the complete live PLD model.

### Task 8: Generate incomplete agency mortgage-REIT workbooks

**Files:**
- Modify: `backend/app/services/excel_export/mappers/mortgage_reit_model.py`
- Modify: `model/src/services/exporters/excel/mortgage-reit-payload.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:** The incomplete agency mortgage-REIT mapper preserves separate GAAP and TBA/swap economic funding, tangible common book value, and residual-income valuation.

- [x] Add a live AGNC redaction check for `average_repo_borrowings`. Assert the missing funding value is blank and the spread, book, residual-income, and common per-share outputs are blank.
- [x] Run the live AGNC case and locate the funding cell and dependent formulas.
- [x] Add the editable sourced input and guard all downstream schedules and valuation outputs.
- [x] Restore the live source value, recalculate, and compare with the complete live AGNC workbook.

### Task 9: Generate incomplete asset-manager workbooks

**Files:**
- Modify: `backend/app/services/excel_export/mappers/asset_manager_model.py`
- Modify: `model/src/services/exporters/excel/asset-manager-payload.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:** The incomplete asset-manager mapper preserves the AUM roll-forward, fee yields, FCFF schedule, and common-equity bridge.

- [x] Add a live BLK redaction check for one annual `base_fee_yield`. Assert the year is blank and blue, dependent base fees and valuation are blank, and the source-reference field is available.
- [x] Run the live BLK case and identify each dependent AUM and fee formula.
- [x] Implement the blank input and formula guards without changing the complete BLK/TROW schedule.
- [x] Restore the source value, recalculate, and compare with the complete live BLK workbook.

### Task 10: Generate incomplete telecom workbooks

**Files:**
- Modify: `backend/app/services/excel_export/mappers/telecom_model.py`
- Modify: `model/src/services/exporters/excel/telecom-payload.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:** The incomplete telecom mapper preserves the subscriber and segment driver schedule and common-equity FCFF bridge.

- [x] Add a live AT&T redaction check for `postpaid_phone_churn`. Assert the affected subscriber roll-forward and downstream valuation remain blank.
- [x] Run the live AT&T case and locate the input and affected forecast years.
- [x] Add the blank analyst-editable churn cell and guard linked subscribers, revenue, FCFF, and valuation until it and its source/status requirements are complete.
- [x] Restore the live value, recalculate, and compare with the complete live AT&T workbook.

### Task 11: Generate incomplete integrated-energy workbooks

**Files:**
- Modify: `backend/app/services/excel_export/mappers/integrated_energy_model.py`
- Modify: `model/src/services/exporters/excel/integrated-energy-payload.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:** The incomplete energy mapper preserves production, realized-price, segment, corporate-financing, reserve-check, and unlevered DCF schedules.

- [x] Add a live XOM redaction check for one fiscal year's `crude_oil_production`. Assert the missing production cell is blank and production-derived revenue, FCFF, and valuation are blank.
- [x] Run the live XOM case and inspect unit/period presentation and all downstream formula references.
- [x] Add the blank production input and guards without treating missing production as zero.
- [x] Restore the live value, recalculate, and compare with the complete live XOM workbook.

### Task 12: Generate incomplete mature-pharma workbooks

**Files:**
- Modify: `backend/app/services/excel_export/mappers/mature_pharma_model.py`
- Modify: `model/src/services/exporters/excel/mature-pharma-payload.ts`
- Modify: `model/src/cli.live.test.ts`

**Interfaces:** The incomplete pharma mapper preserves a product-by-product sales and patent/LOE schedule followed by the mature-pharma FCFF DCF.

- [x] Add a live PFE redaction check for one current product's filed revenue. Assert that product/year is blank, product and aggregate forecast cash flows are blank, and Data Review identifies the affected product and period.
- [x] Run the live PFE case and locate the dynamic product row and dependent forecast formulas.
- [x] Add the blank product-revenue input and formula guards; keep region-specific patent dates distinct from modeled global LOE assumptions.
- [x] Restore the live revenue, recalculate, and compare with the complete live PFE workbook.

### Task 13: Keep trading-comparable routes honest when inputs are incomplete

**Files:**
- Modify: `backend/app/services/valuation/classifier.py`
- Modify: `backend/app/services/excel_export/service.py`
- Modify: `backend/app/services/excel_export/mappers/comparable_model.py`
- Modify: `backend/app/services/excel_export/mappers/comps.py`
- Modify: `backend/app/api/contracts.py`
- Modify: `model/src/application/run-valuation-job.ts`
- Modify: `model/src/services/exporters/excel/payload-mappers.ts`
- Test: `model/src/cli.live.test.ts`

**Interfaces:** EV/EBITDA and EV/Revenue keep separate routes and formula-based peer medians. Missing target metrics or qualified current-peer inputs produce an incomplete workbook only when the comparable model family exists; stale and fallback peers are never inserted. Manual facts require source/reference entries.

- [x] Add live CAT EV/EBITDA, SNOW EV/Revenue, and TGT fallback-peer checks. Redact one current peer denominator for CAT/SNOW and assert `input_required`; assert TGT's model family is recognized, fallback peers are not inserted, and its missing qualified peers produce an incomplete workbook.
- [x] Run the cases and inspect peer rows, source references, formula median, bridge, and sensitivity dependencies.
- [x] Add blank editable cells and entry validation for missing peer/target facts; guard peer median, valuation bridge, sensitivity, and per-share outputs until three qualified current peers and the common-equity bridge are complete.
- [x] Restore the live metrics, recalculate, and compare with the complete live CAT and SNOW workbooks.

### Task 14: Verify the complete three-state product path and update documentation

**Files:**
- Modify: `model/src/cli.live.test.ts`
- Modify: `README.md`
- Modify: `docs/CLI_ARCHITECTURE.md`
- Modify: `CHANGELOG.md`
- Modify: `backend/README.md`

**Interfaces:** Tasks 1–13 provide one complete live case, one live-data redaction case, and one unsupported case for every implemented family. The CLI distinguishes ready from incomplete workbooks; unsupported still exits without writing.

- [x] Add the end-to-end CLI assertions for output path, status, missing input list, formula editability, unprotected sheets, no valuation output for incomplete cases, and no workbook for unsupported cases.
- [x] Edit one native formula in a copied live workbook, recalculate it, and assert the dependent output changes while a separate unedited workbook cell remains unchanged.
- [x] Run focused live tests for every route group and verify the complete/incomplete/unsupported matrix.
- [x] Run `npm test` from `model/` for the complete live-only suite, then `npm run typecheck` from `model/`.
- [x] Run `python3 -m compileall -q backend/app` and `git diff --check`.
- [x] Review representative rendered workbooks after LibreOfficeDev recalculation and confirm engine/workbook parity, blank-output behavior, visible missing inputs, and no formula errors.
- [x] Update documentation with exact tested routes, incomplete-template behavior, unsupported boundaries, input-edit instructions, and current annual-data limitations.
- [x] Inspect the final diff and confirm no pre-existing dirty or untracked user files were changed outside the plan's target paths.

---

## Follow-on work that remains part of the active product goal

This plan does not mark DCF Builder Pro complete. After the shared incomplete-workbook contract is verified, continue the parent broad-coverage plan through separate reviewed model specifications and plans for remaining intended archetypes and issuer generalization: regulated utilities, life insurance, pipeline biotechnology, alternative asset managers, commercial mortgage REITs, broader wireless/telecom issuers, other pharma issuers, and energy/materials subtypes beyond the first integrated issuer. Each family needs its own defensible method, reusable source contract, formula workbook, and live acceptance case. Keep the goal active until those family-level requirements and the end-to-end completion audit pass.
