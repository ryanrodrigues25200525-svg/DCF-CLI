# DCF Builder CLI + MCP Model Library — Audited Plan

**Status:** Phases 0–6 complete for the approved CLI + MCP model-library scope. The release is version 2.0.0; remaining code defects and coverage boundaries are tracked separately in `BUGS.md` and `docs/MODEL_COVERAGE.md`.

## Current project status — reviewed 3 October 2026

| Phase | Status | Result |
| --- | --- | --- |
| 0 — Audit | Complete | Existing routes, data sources, and engine boundaries were inventoried before implementation. |
| 1 — Persistent model library | Complete | Configurable local root, SQLite index, manifests, revisions, and manual-edit conflict checks. |
| 2 — Shared CLI/services | Complete | CLI build, refresh, export, review, filing sync, proposal, and watch commands use shared application services. |
| 3 — Local MCP and review skill | Complete | Local stdio tools and a focused review skill are available. |
| 4 — Traceable proposals | Complete | Source-backed cell changes require review and approval; applying one creates a revision. |
| 5 — Filing watch | Complete | New filings can be queued for review without silently changing workbooks. |
| 6 — Verification and documentation | Complete | Live-only integration checks, workbook recalculation/inspection, and operating docs are recorded below. |

The full plan is complete; the project is now in post-plan hardening and
coverage work. The current confirmed code bugs are listed in `BUGS.md` (8
open entries at this review); unsupported and input-required company routes
are tracked separately in `docs/MODEL_COVERAGE.md`. GitHub had no issue
records or open pull requests at this review, so those entries have not been
assigned GitHub issue numbers.

## Goal

Keep DCF Builder local-first and make its existing issuer-specific workbook pipeline usable as a persistent model library from the CLI and ChatGPT/Codex MCP. Filings and market data remain deterministic inputs; AI may review and propose updates, but never silently edits an accepted workbook.

## Phase 0 — Audit of the current checkout

### Existing capabilities

- **CLI:** `bin/dcfbuild.mjs` delegates to `model/src/cli.ts`. It accepts one ticker, `--output`, and `--force`, prompts when no ticker is supplied, starts the local FastAPI service, runs `model/src/application/run-valuation-job.ts`, and writes one `.xlsx` file.
- **Sector routes:** the active registry has 14 production routes: operating DCF, EV/EBITDA, EV/Revenue, commercial-bank residual income, P&C residual income, equity REIT AFFO, utility DDM, asset-manager DCF, telecom DCF, mortgage-REIT residual income, integrated-energy DCF, mature-pharma DCF, biotech pipeline rNPV, and MET/PRU life-insurer DCF. Issuer/source limits are documented and unsupported routes fail closed.
- **Data pipeline:** Python `edgartools`/FastAPI owns SEC retrieval, canonical financials, eligibility, and source readiness. OpenBB providers supply market, peer, and macro data. TypeScript validates API contracts and currently calculates the sector models.
- **Workbook exporter:** FastAPI validates the export contract and calls Python `openpyxl` mappers. Workbooks use native Excel formulas, source review, editable assumptions, and missing-input gates. The CLI can write to a chosen path but has no saved-library index or `open` command.
- **Storage:** the backend uses SQLite/`aiosqlite` for financial caching. The checkout has no persistent workbook library, per-company manifest, accepted revision history, proposal table, manual-edit conflict detection, or `DCF_MODELS_DIR` setting.
- **MCP and AI review:** no local MCP server, typed model-library MCP tools, AI review skill, proposal/apply workflow, or filing-watch scheduler was found in `backend/`, `model/`, or `bin/`.
- **Tests:** `npm test` in `model/` runs only `model/src/cli.live.test.ts`, a 79-test live suite. The full suite passed 79/79 in 15m02s on 2026-10-02. It requires `EDGAR_IDENTITY`, network access, and live provider data.
- **Working tree:** this checkout is on `main` with extensive existing modifications and deletions. Phase 0 did not reset, clean, stage, or commit anything.

### Runtime/model-engine decision

The supplied plan says the CLI, MCP server, and watch jobs should share a **Python valuation engine**. The audit found no Python valuation engine: the active model routes and calculations live in TypeScript, while Python owns the SEC/canonical-data backend, classifier, and Excel exporter. Porting all sector models to Python would be a broad rewrite and would overlap the working TypeScript engines.

Implementation decision for this phase: keep one calculation engine by having CLI, MCP, and watch operations call the existing TypeScript model service. This preserves all 14 routes and avoids a high-risk port before the requested library is usable. Python continues to own SEC retrieval, canonical data, eligibility, and workbook export. Do not duplicate route math in command handlers or MCP tools. A Python port is out of scope unless separately requested.

### OpenCode agent availability

OpenCode CLI v2.0.21 is installed and configured. `opencode models` lists `opencode-go/muse-spark-1.3-contributor`, which is the selected model for delegated implementation. Do not inspect or change credentials.

## Executed phase checklist

All planned implementation tasks are complete. The checked items below record delivered scope.


### Phase 1 — Persistent model library

- [x] Add `DCF_MODELS_DIR` and `dcf config set models-dir`; validate and display the resolved path.
- [x] Store company workbook metadata and current source snapshot in SQLite. Record ticker, model route, currency, unit scale, source accession/date, workbook hash, build date, and readiness status.
- [x] Save accepted revisions as immutable copies with parent hash and timestamps. Detect manual edits by comparing the saved workbook hash before applying an update.
- [x] Add `dcf models list`, `dcf model inspect <ticker>`, `dcf model open <ticker>`, and directory configuration commands. Opening uses the host spreadsheet application and does not overwrite a model.

### Phase 2 — Shared CLI/service interface

- [x] Add `dcf build <ticker>` while preserving the existing `dcfbuild <ticker>` command and flags.
- [x] Add `dcf filings sync <ticker>`, `dcf model review <ticker>`, `dcf model propose-update <ticker>`, `dcf model apply <proposal-id>`, and `dcf watch status` through application services, not duplicated route math.
- [x] Use the shared model engine selected above for build, MCP, and scheduled work.

### Phase 3 — Local MCP server and review skill

- [x] Add a local stdio MCP server with typed read-only tools for model listing, inspection, latest-filing status, workbook validation, and source snapshots.
- [x] Add proposal creation as a separate tool. Applying a proposal must require an explicit approval step and save a new revision.
- [x] Add a focused `dcf-model-review` skill describing source checks, formula/tie-out review, missing-input handling, proposal format, and approval requirements.

### Phase 4 — Traceable AI update proposals

- [x] Build proposal records from the prior workbook, normalized SEC/OpenBB facts, latest identity-validated filing metadata, and per-fact source lineage. Narrative sections are retrieved through the assistant's SEC research tools using the filing reference.
- [x] Require each change to identify ticker, accession, sheet/cell, prior value/formula, proposed value/formula, rationale, source, and deterministic validation results.
- [x] Apply accepted proposals to a copy, retain the old revision, recalculate, and run live source, formula, tie-out, and missing-input checks before marking the revision ready.

### Phase 5 — Filing watch process

- [x] Add a local scheduler that checks for new SEC filings, refreshes the source snapshot, runs deterministic checks, and marks a company update-ready.
- [x] Queue review only; never edit or replace a workbook automatically.
- [x] Support pause/resume/status and recoverable errors without requiring an active assistant session.

### Phase 6 — Live verification and documentation

- [x] Keep validation in the live-only `model/src/cli.live.test.ts` suite; do not add fixture-only providers/tests.
- [x] Test library revisions and proposals on copies of live-generated workbooks. Recalculate with LibreOffice and scan formula errors, ties, source links, and missing-input gates.
- [x] Document local setup, model-root configuration, CLI/MCP usage, approval workflow, watch lifecycle, and restoring older revisions.

## Global constraints

- Preserve all existing sector routes, OpenBB/EDGAR integrations, source lineage, native editable Excel formulas, and the dirty working tree.
- Never silently overwrite or auto-apply a proposed workbook change.
- Never fill missing source data with guesses or display valuation while required inputs fail.
- Do not reset, clean, stage, or commit the existing checkout.


## Verification and remaining boundary

The filing-agent accession-prefix defect identified in the earlier review is
fixed in `model/src/watch/source-sync.ts`: sync validates endpoint CIK and
ticker against the issuer, and does not reject a filing because its accession
prefix belongs to a filing agent. The live AAPL check described in `BUGS.md`
covered the formerly rejected accession. The remaining post-plan work is the
confirmed bug and model-coverage backlog linked above, not an incomplete phase
of this plan.

- Latest recorded live suite before this documentation update: 82/82 passed, exit 0, 869.14 seconds. The changes include live-only checks for fail-closed outcomes when provider inputs are stale or a source-backed composite is incomplete. The suite was not rerun for this docs-only update.
- Fresh AAPL workbook: 1,986 native formulas, cached M51 result 136666.178923099 with formula =M32+M48, and zero cached formula errors. A live filings-list check selected Form 10-Q accession 0000320193-26-000020 filed 2026-07-31 while preserving 0000320193-25-000079 Form 10-K as the workbook fact basis.
- Typecheck passed on the implementation commit. `git diff --check` passed on that implementation and on this documentation update; this update records the first tagged 2.0.0 CLI release.
- The MCP snapshot contains normalized EDGAR/OpenBB facts, source lineage, and latest filing identity, not full SEC narrative text. The review skill directs the assistant to use an available SEC research tool for narrative sections and to state when that text could not be retrieved. Market and valuation-context providers may return cached values; freshness gates remain enforced.
