# Broad Company Model Coverage Implementation Plan

> **For agentic workers:** Use `superpowers:executing-plans` to implement this plan inline. Do not delegate. Steps use checkbox syntax for tracking.

**Goal:** Expand safe live valuation coverage across core operating archetypes and source-ready peer-multiple cases without misrouting unsupported companies.

**Architecture:** The backend classifier owns an explicit model registry and operating archetype. Core operating companies use formula-driven driver schedules with the common DCF valuation method. Banks, P&C insurers, and equity REITs keep their dedicated routes; special sectors remain blocked until their sources and models pass acceptance.

**Tech Stack:** TypeScript, FastAPI/Pydantic, SEC `edgartools`, Vitest live-only CLI suite, OpenPyXL workbook mapper, bundled LibreOfficeDev recalculation with Artifact Tool review and edit checks.

**Spec:** `docs/superpowers/specs/2026-09-30-broad-company-model-coverage-design.md`

**Current status:** XOM, PFE, MRNA, MET, and PRU have issuer-specific specialist workbooks; MET/PRU keep capital-retention and upstream-distribution assumptions blank and source-required. CVX, MRK, unsupported life insurers, and mixed-utility NEE remain explicitly blocked. Focused live checks, typecheck, backend compilation, lint correctness checks, workbook recalculation, and the complete live-only suite pass.

## Global Constraints

- Run only live tests in `model/src/cli.live.test.ts`; do not add fixtures or test-only mocks.
- Do not invent SEC metrics or use stale/default market inputs as current values.
- Preserve source period, concept, accession, filed date, currency, unit, and scale.
- Keep formulas editable and readable; forecasts must not be written as values.
- Block an archetype when required inputs or its production exporter are missing.
- Preserve the current dirty checkout. Do not reset, stage, commit, install developer tools, or discard existing user changes.

## Review Focus

- **Positive-EBIT specialist:** energy, biotech, financial, utility, and REIT subtypes must not inherit generic DCF when their economics differ.
- **Unknown industry:** must not inherit technology-hardware growth or margins.
- **Allowed model IDs:** must match both a calculation engine and a formula workbook adapter.
- **Peer coverage:** stale, duplicate, or thin peers block a multiple route instead of becoming a guessed median.
- **Missing versus zero:** an unavailable segment/operating metric remains visible and cannot silently become zero.

---

### Phase 0 — Safe routing and assumption defaults

#### Task 1: Test model-registry eligibility

**Files:** modify `model/src/cli.live.test.ts`, `backend/app/services/valuation/classifier.py`, and the model registries/contracts.

**Interfaces:** The classifier reports `operating_archetype`, one preferred model, and only production `allowed_models`.

- [x] Add a live classifier test for AAPL, CRM, WMT, CAT, NVDA, SNOW, plus positive-EBIT XOM and T specialist block cases.
- [x] Run focused live checks to observe missing archetypes and unsafe generic-Dcf routing.
- [x] Implement explicit archetypes, source readiness, and production-only DCF/multiple routes.
- [x] Re-run live checks; bank, insurance, and REIT routes remain intact. NVDA remains blocked until its current CapEx and securities bridge map.

#### Task 2: Close unimplemented workbook routes

**Files:** modify `backend/app/api/contracts.py`, `backend/app/services/excel_export/mappers/__init__.py`, `backend/app/services/excel_export/mappers/sector_model.py`, and `model/src/services/valuation/router.ts`.

**Interfaces:** Unsupported model IDs return a source-aware block at API/export boundaries; residual-income and utility drafts cannot produce a workbook or supported valuation.

- [x] Add a live export assertion for unsupported residual-income and utility workbook IDs, plus rejection of multiple exports without source metadata.
- [x] Run focused live checks and verify the draft routes reached the exporter before the guards were added.
- [x] Remove draft route reachability; preserve bank, insurance, REIT, DCF, and multiple workbook behavior.
- [x] Re-run focused live checks.

#### Task 3: Remove the unknown-industry preset fallback

**Files:** modify `model/src/core/data/industry-templates.ts`, `model/src/services/dcf/assumption-policy.ts`, `model/src/application/run-valuation-job.ts`, and `model/src/cli.live.test.ts`.

**Interfaces:** Unrecognized industries do not receive `tech-hardware` assumptions. Core operating DCF growth begins with an explicitly described historical calculation; any sector-based assumption is labeled as an analyst input.

- [x] Add a live LUMN issuer test for a telecom profile outside the preset map; assert it receives no technology-hardware preset and retains historical-derived growth.
- [x] Run it to observe the technology-hardware fallback.
- [x] Remove the unknown-industry preset fallback and static growth preset from the operating route.
- [x] Re-run the live check and inspect Data Review source/assumption notes.

### Phase 1 — Core operating archetype forecasts

#### Task 4: Add canonical operating-driver data and mappings

**Files:** modify `backend/app/services/edgar.py`, `backend/app/services/valuation/canonical.py`, `backend/app/api/contracts.py`, `model/src/core/types/native.ts`, and `model/src/services/integration/sec/native-normalizer.ts`.

**Interfaces:** Common historical lines preserve value, method, period, and SEC provenance. The supported operating feed now reconciles combined costs and exposes aggregate operating working capital. Segment KPIs remain absent where the current SEC adapter does not extract a usable filing table.

- [x] Add live mapping checks for Caterpillar combined operating costs and Salesforce aggregate working capital.
- [x] Run live checks and record absent peer-debt, security, inventory, payable, and CapEx tags rather than replacing them with guessed values.
- [x] Reconcile CAT COGS from the filed total-cost bridge; add source-backed aggregate operating NWC for SaaS when individual current-liability components are not separately disclosed.
- [x] Re-run checks and verify source accession, filed date, fiscal period, units, and explicit missing/not-applicable states. Segment details remain unavailable in the current SEC adapter.

#### Task 5: Build core operating driver profiles

**Files:** create `model/src/services/valuation/operating-model.ts`; modify `model/src/services/valuation/router.ts`, `model/src/core/types/model.ts`, `model/src/application/run-valuation-job.ts`, and `model/src/cli.live.test.ts`.

**Interfaces:** `OperatingArchetype` selects a five-year operating-driver profile for technology/hardware, subscription software, consumer/retail, industrial/manufacturing, or semiconductors. The forecast returns FCFF from linked revenue, operating margin, tax, D&A, CapEx, and working-capital drivers; no profile invents undisclosed company KPIs.

- [x] Add live driver/profile checks for retail and live model/export cases for hardware, software, retail, industrials, and semiconductors.
- [x] Observe DCF input gaps; CAT/SNOW/NVDA route through peer multiples or remain blocked as their source profile requires.
- [x] Implement five-year archetype profiles from filed history, three-year margin/reinvestment averages, and labeled editable analyst assumptions.
- [x] Re-run live calculations; the unknown telecom subtype remains blocked.

#### Task 6: Export formula-driven operating archetypes

**Files:** modify `model/src/services/exporters/excel/types.ts`, `model/src/services/exporters/excel/index.ts`, `model/src/services/exporters/excel/payload-mappers.ts`, `backend/app/api/contracts.py`, and `backend/app/services/excel_export/mappers/`.

**Interfaces:** The payload carries the selected archetype, reported history, assumption sources, and engine forecast. The workbook has a labeled driver schedule and readable formulas for each forecast line; Python does not write forecast values.

- [x] Add live workbook assertions for blue editable assumptions, formula links, source review, peer medians, and the software residual schedule.
- [x] Inspect live exports and correct the advanced-mode CapEx/D&A mismatch between TypeScript and workbook formulas.
- [x] Implement formula-driven archetype DCF schedules plus separate EV/EBITDA and EV/Revenue formula workbooks.
- [x] Recalculate AAPL, CRM, WMT, CAT, and SNOW live workbooks with bundled LibreOfficeDev, then review and edit-test them with Artifact Tool. No formula errors; engine/workbook equity values tie within 0.1% and per-share values within $0.01. Growth, margin, capex, terminal-growth, multiple, debt, and share-count edits move output in the expected direction.
- [x] Add a live-source short-history export check by retaining three filed AAPL years. The fixed workbook leaves two leading timeline columns blank and keeps exactly the five engine forecast years in M:Q.
- [x] Re-run focused live exports for AAPL, CRM, WMT, CAT, and SNOW.

### Phase 2 — Peer-multiple routes for source-ready companies

#### Task 7: Implement EV/EBITDA and EV/Revenue valuation

**Files:** modify `backend/app/services/valuation/classifier.py`, `backend/app/api/contracts.py`, `model/src/core/types/native.ts`, `model/src/application/run-valuation-job.ts`, `model/src/services/valuation/router.ts`, `backend/app/services/excel_export/mappers/sector_model.py`, and `backend/app/services/excel_export/mappers/__init__.py`.

**Interfaces:** EV/EBITDA requires positive source-backed EBITDA; EV/Revenue requires positive source-backed revenue and a non-biotech archetype. Both require three current source-ready peers and produce a formula-based equity bridge.

- [x] Add live checks for peer-ready SNOW and CAT plus fallback-peer TGT.
- [x] Run checks and confirm fallback peer sets block before calculation.
- [x] Implement EV/EBITDA and EV/Revenue routing, source-backed bridges, formula medians, optional editable multiple override, and sensitivities.
- [x] Recalculate live CAT and SNOW workbooks, test multiple, debt, and share-count edits, and verify engine parity with no formula errors.
- [x] Re-run focused live checks and exports.

### Phase 3 — Additional specialist families

Create a separate spec and plan before implementing each family: energy/materials; telecom; mature and pipeline pharma; life insurance; asset management; mortgage REITs; regulated utilities. For each, inspect live SEC/regulatory source readiness, define an independent valuation method, and add a representative plus unsupported-edge live case. Do not enable a route when the required data feed is unavailable.

#### Specialist-family task ledger

- [x] **Traditional asset managers:** BLK/TROW AUM-and-fee model, formula workbook, and source-readiness blocks for IVZ and alternatives. See `docs/superpowers/plans/2026-09-30-asset-manager-model.md`.
- [x] **U.S. wireless telecom:** AT&T subscriber-and-segment DCF, source-backed formula workbook, and VZ source-definition block. See `docs/superpowers/plans/2026-10-01-telecom-model.md`.
- [x] **Energy/materials:** XOM has an integrated production/segment DCF, formula workbook, and live CLI export. CVX, independent E&Ps, miners, and other energy types remain blocked outside the XOM source contract. See `docs/superpowers/plans/2026-10-01-integrated-energy-model.md`.
- [x] **Mature pharma:** PFE has a product-sales/patent DCF, formula workbook, and live CLI export. The workbook keeps U.S./Europe/Japan patent years distinct from an editable global LOE proxy. MRK and other pharma issuers remain blocked pending their own source contracts. See `docs/superpowers/plans/2026-10-01-mature-pharma-model.md`.
- [x] **Pipeline biotechnology:** MRNA now has an input-required commercial DCF plus asset-level pipeline rNPV workbook. SEC-listed early-stage and paused candidates remain visible with explicit inclusion and residual-value inputs; no PoS, sales, launch, partner share, margin, or cost defaults are guessed. Other biotech issuers remain blocked until their source contracts pass. See `docs/superpowers/plans/2026-10-02-biotech-pipeline-rnpv.md`.
- [x] **Life insurance source audit:** the 2025 MET and PRU 10-Ks disclose different adjusted-earnings measures, partial RBC/statutory-capital data, and subsidiary dividend limits; the current app feed does not provide a complete legal-entity capital-retention/distributable-earnings schedule. See `Finance Knowledge Graph/Notes/2026-10-02 Life-insurer model source audit.md`.
- [x] **Life insurance DCF:** MET/PRU have issuer-specific distributable-earnings workbooks with their distinct filed segment bases, scoped statutory-capital disclosures, source-required capital-retention/upstream schedules, parent claims bridge, editable formulas, and live LibreOffice/engine-parity checks. Other life insurers remain blocked. See `docs/superpowers/specs/2026-10-02-life-insurance-distributable-earnings-dcf-design.md`.
- [x] **Mortgage REITs:** AGNC uses a separate agency-MBS residual-income route with sourced repo/TBA/swaps, book, preference, and distribution schedules; the formula workbook and live CLI export pass. STWD and other issuers stay blocked pending separate source contracts. See `docs/superpowers/plans/2026-10-01-mortgage-reit-model.md`.
- [x] **Regulated utilities:** live DUK/SO filing checks did not yield complete jurisdictional rate-base, authorized-return, and equity-capital schedules; NEE remains mixed. DUK now receives an input-required rate-base DDM workbook while source-ready utility valuation remains disabled; NEE stays unsupported. See `docs/superpowers/plans/2026-09-30-regulated-utility-model.md`.

### Final verification

- [x] Re-run `npm run typecheck` in `model/` after the MET/PRU route.
- [x] Re-run `python -m compileall -q backend/app`, targeted Ruff correctness checks, and `git diff --check` after the MET/PRU route.
- [x] Run the complete live-only `npm test` in `model/` after all scoped family audits: 79/79 passed in 15m02s on 2026-10-02.
- [x] Recalculate live XOM and PFE workbooks with LibreOfficeDev; verify formula behavior, engine parity, sensitivities, and formula-error scans. Artifact Tool was unavailable for the newest specialist models, so the rendered PDF pages were visually reviewed instead.
