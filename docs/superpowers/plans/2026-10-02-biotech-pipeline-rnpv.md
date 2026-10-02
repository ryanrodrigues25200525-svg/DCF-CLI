# Biotech Pipeline rNPV Implementation Plan

> Execute inline with live-only acceptance. Preserve the dirty checkout; do not stage, commit, reset, or discard work.

**Goal:** Replace MRNA's unsupported-only outcome with an input-required, editable commercial-plus-pipeline rNPV model. No commercial or pipeline valuation appears until the required assumptions and sources are supplied.

**Spec:** `docs/superpowers/specs/2026-10-02-biotech-pipeline-rnpv-design.md`

## Scope

- Initial issuer: U.S.-listed Moderna (MRNA), identified through the live SEC profile.
- Existing commercial portfolio: reported consolidated revenue as the disclosed base; the workbook labels product-level revenue as unavailable.
- Pipeline assets: source list and stage/partner disclosures from the live FY2025 10-K narrative and tables. Individually forecast late-stage programs have blank sales, PoS, launch, retained share, cash margin, and development-cost inputs. Every other source-listed program, including paused candidates, has an explicit include switch and a blank analyst-entered present value. A separate input covers pipeline outside the mapped filing inventory.
- Other biotech issuers remain unsupported until their filing-specific product and partner economics source contracts pass.

### Task 1: Capture live pipeline source rows

**Files:** modify `backend/app/services/edgar.py`, `backend/app/api/contracts.py`, `model/src/core/types/native.ts`, `model/src/api/contracts.ts`, and `model/src/cli.live.test.ts`.

**Interfaces:** Add `pipeline_assets[]` to native MRNA financial data with asset identifier, disclosed name/indication, disclosed stage/status, partner, and SEC accession/date/section metadata. The parser may return only facts found in the current 10-K; no launch or value estimates are generated.

- [x] Add a live MRNA source-mapping assertion against the latest 10-K accession; establish which pipeline candidates are active, paused, or partnered.
- [x] Run it red and inspect the existing SEC HTML representation of the company narrative/table.
- [x] Parse program identifiers and nearby stage/partner statements with stable row identifiers and filing provenance.
- [x] Verify duplicate programs collapse to one row and a filing with no parseable asset list does not claim a complete pipeline schedule.

### Task 2: Register the biotech valuation route

**Files:** modify `backend/app/services/valuation/model_eligibility.py`, `backend/app/services/valuation/classifier.py`, `model/src/core/types/native.ts`, `model/src/api/contracts.ts`, and `model/src/cli.live.test.ts`.

**Interfaces:** `biotech_pipeline_rnpv` is `input_required` when the live pipeline list and market bridge exist but commercial and pipeline assumptions are absent. Other biotechs stay unsupported until their asset source contracts are implemented.

- [x] Add a live MRNA readiness test asserting an implemented route, explicit missing-input gaps, and no calculation readiness.
- [x] Keep negative-EBIT biotech issuers out of generic EV/Revenue and generic FCFF routes.
- [x] Re-run live classifier checks for MRNA and unsupported biotech boundaries.

### Task 3: Define the structured input manifest and model payload

**Files:** modify `model/src/application/run-valuation-job.ts`, `model/src/services/exporters/excel/types.ts`, `model/src/api/contracts.ts`, and `backend/app/api/contracts.py`; create `model/src/services/valuation/biotech-rnpv-model.ts`. The incomplete source-backed payload is assembled by the existing valuation job.

**Interfaces:** Required inputs include commercial-franchise growth/cash margin/terminal growth; late-stage assets have inclusion, launch year, peak sales, time to peak, exclusivity, erosion, probability of success, retained share, contribution margin, and development-cost PV. Every other SEC-listed asset has an inclusion switch and analyst-entered rNPV, with a separate rNPV input for unmapped programs. Asset facts preserve current filing source metadata. Missing inputs remain null and source references are required on source-specific assumptions.

- [x] Add red live payload parsing and input-manifest assertions, including paused/partnered programs.
- [x] Build the incomplete payload without invoking the valuation engine or placing output numbers in forecast fields.
- [x] Validate asset identifiers are unique, list coverage is current/source-backed, all assumption ranges are finite, and negative/incomplete states fail closed.

### Task 4: Build a risk-adjusted pipeline and commercial DCF workbook

**Files:** modify `backend/app/services/excel_export/mappers/__init__.py`, `backend/app/services/excel_export/exporter/core.py`, and `model/src/cli.live.test.ts`; create `backend/app/services/excel_export/mappers/biotech_model.py`.

**Interfaces:** `Biotech Model` and `Pipeline Valuation` show sourced facts and disclosure basis, explicit blank assumptions, a commercial-franchise DCF, 35 years of per-asset probability-weighted FCFF and remaining costs for active late-stage programs, inclusion and analyst-entered rNPV for every other source-listed program, unmapped pipeline rNPV, the common-equity bridge, per-share value, and sensitivities. All output formulas are gated by the shared input status.

- [x] Run a live MRNA export check red before adding the mapper.
- [x] Add blue/unlocked assumption cells and required source references, with editable program inclusion controls and scope.
- [x] Implement formula-driven launch ramps, a 35-year finite pipeline schedule, post-LOE erosion, probability weighting, development-cost subtraction, commercial cash flows, equity bridge, and sensitivities.
- [x] Recalculate a live incomplete MRNA workbook while inputs are blank, invalid, and restored with disclosed test assumptions; verify no formula errors.
- [x] Edit a native formula in a copy and confirm downstream valuation changes.

### Task 5: Verify, document, and preserve explicit boundaries

- [x] Compare restored workbook outputs with the TypeScript rNPV engine at 0.1% equity and $0.01/share for the same test inputs.
- [x] Run focused MRNA live checks, typecheck, Python compileall, `git diff --check`, and the full live-only `npm test` suite.
- [x] Update README/CLI docs with the MRNA tested route, missing input behavior, and remaining biotech source-contract limits.
- [x] Inspect the implementation and preserve the pre-existing dirty checkout without staging or committing.
