# Changelog

All notable changes to **DCF CLI** are documented in this file. Early entries describe the desktop release; the current product is the CLI.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Added a pending build-candidate gate: `dcf build` and `dcf model update` stage a validated candidate (route/readiness, source accession, mapped period, base revision) without publishing. `dcf model candidate`, `candidate-verify`, `accept --approve`, and `candidate-reject` record the AI review and promote only on explicit human approval; stale bases and manual edits fail closed. Mirrored as MCP tools `candidate_inspect/verify/accept/reject` with specific error codes.
- Documented the full CLI surface (`config models-dir`, watch variants, `--json`) in README and OPERATIONS; the model-library guide remains the complete reference.

### Fixed

- `dcf model open` requires the opener's clean exit, reports headless Linux as path-only, and never claims an unconfirmed open (#1).
- Python discovery tries `python`/`python3`/`py` on Windows and `python3`/`python` on POSIX (#2).
- Proposal values type booleans, exponent numbers, and `__BLANK__` blanks; `=`-prefixed values are rejected in favor of explicit formula edits (#3, #11 partial).
- Missing industry/sector renders as “Not disclosed”, never a guessed “Technology” (#4).
- The installer writes an idempotent PATH line to the shell-appropriate startup files (#5).
- LibreOffice discovery searches PATH on every platform without shelling out to `which`, with a bounded version probe (#6, #7).
- `dcf mcp` handles `--help` and rejects extra arguments before the server starts (#8).
- Flag-first input (`dcf build --models-dir <dir>`) reports command usage instead of a misleading ticker error (#22).

## [2.0.0] — 2026-10-03

> **DCF CLI + MCP Model Library.** Major transition from the desktop app to a local-first command-line model builder with persistent workbooks, reviewable revisions, and a local MCP interface.

### Added

- Added a configurable local model library with a SQLite index, company manifests, immutable workbook revisions, source snapshots, and checks for manual edits before refreshes.
- Added CLI workflows to build, update, export, list, inspect, open, review, and validate company workbooks; build and update exports include the UTC date and ticker in the filename.
- Added filing sync and a local watcher that refreshes source snapshots and queues review without changing accepted workbooks.
- Added a local stdio MCP server for model discovery, source and filing review, workbook inspection, and structured update proposals. Applying a proposal requires explicit approval and creates a new revision.
- Added the `dcf-model-review` skill for source-backed review, formula and tie-out checks, missing-input gates, and human approval.
- Added `input_required` exports for implemented valuation families. Missing inputs appear as blank, unlocked cells with source-reference tracking; dependent valuation formulas remain blank until the workbook is ready.
- Added incomplete formula workbooks for operating DCF, commercial banks, P&C insurance, equity REITs, agency mortgage REITs, traditional asset managers, telecom, integrated energy, mature pharma, EV/EBITDA, and EV/Revenue comparables.
- Added an MRNA-only input-required biotech pipeline rNPV workbook with source-mapped SEC assets, explicit paused/early-program inclusion controls, editable commercial and clinical assumptions, a 35-year pipeline formula schedule, and live recalculation/engine-parity checks. Missing forecasts and clinical assumptions remain blank and no valuation is shown until inputs and references pass review.
- Added MET and PRU input-required life-insurance distributable-earnings DCF workbooks. The models preserve their distinct filed earnings bases, show entity-scoped capital/dividend disclosures, and use blank source-required capital, upstream-capacity, tax-conversion, and parent-claims inputs with native editable formulas and sensitivity.
- Added live checks for blank, invalid, and restored inputs, current-peer preservation, LibreOffice formula recalculation, and direct formula edits. Unsupported model families continue to stop without a workbook.

### Changed

- Replaced the Next.js/Electron UI workflow with a ticker-in, Excel-out CLI and persistent local model-library commands.
- Kept valuation calculations in the shared TypeScript model engine used by CLI and MCP operations; Python owns SEC retrieval, canonical financials, eligibility, and workbook export.
- Replaced the undeclared `officecli` export dependency with direct `openpyxl` workbook generation.
- Added issuer-specific XOM integrated-energy, PFE mature-pharma, MRNA pipeline-biotech, and MET/PRU life-insurance formula-workbook routes with live SEC-source checks. Other energy, pharma/biotech, life-insurance, and utility issuers remain blocked where their source contracts do not pass.
- Filing identity checks validate the filings-list response CIK and ticker against the issuer profile; accession prefixes are treated as submitting-account identifiers and may belong to filing agents.

### Fixed

- Removed an operating-DCF fallback that could derive a pseudo-valuation from market capitalization without forecast rows; incomplete source data now fails closed.
- Corrected filing sync so a valid issuer filing is not rejected only because its accession prefix belongs to a filing agent.
- Hardened workbook refreshes against export-path collisions, missing stored hashes, and accidental overwrite of manually edited library files.

## [1.3.0] — 2026-08-23

> **Tier 3 Infra/UX Polish** — offline resilience, keyboard-first controls, observability, bank-aware empty states, and a full E2E valuation matrix. Tagged as both `v1.3.0` and `1.3.0` on commit `86f589b`.

### Added

- **Offline cache & sync** (`useOfflineSync`, `OfflineBadge`)
  - `navigator.onLine` detection with a queued retry store (`dcf-offline-queue`) and 30-min `localStorage` cache (`dcf-cache-*`, `CACHE_TTL_MS`).
  - Automatic sync on `online` / `visibilitychange` reconnect; striped yellow `OfflineBadge` with queued-count and spinner.
  - SSR-safe `localStorage` guards and silent eviction when storage is full.
- **Keyboard-first UX**
  - `⌘K` / `Ctrl+K` focuses the ticker search, `/` cycles scenarios, `E` triggers export — all guarded so typing inside inputs is never hijacked.
  - Wired in `SearchBar` and `DCFBuilderContainer`.
- **Observability — Sentry**
  - `frontend/sentry.client.config.ts` + `frontend/sentry.server.config.ts` (`@sentry/nextjs@^8.53.0`) with `tracesSampleRate: 0.1`, prod-only enablement, and `maxValueLength: 500`.
  - `frontend/src/instrumentation.ts` (`Next.js` `register()` hook) dynamically imports `@sentry/nextjs` on the `nodejs` runtime.
  - `core/logger.ts` captures `X-Request-ID` for end-to-end request tracing; `frontend/src/hooks/useDiagnostics.ts` surfaces diagnostics.
- **Bank-aware financial rendering**
  - New `frontend/src/components/features/statements/BankStatementView.tsx` (289 LOC) — Stripe-style sectioned view (`Net Interest` → `Provision for Credit Losses` → `Non-Interest Income & Expense` → `Other Items` → `Net Income`) with concept matchers for banks/insurers.
  - New `frontend/src/components/features/statements/EmptyState.tsx` (118 LOC) — branded empty state for `isFinancialInstitution` (`company-classifier`).
  - `FinancialStatements.tsx` now routes `isFinancialInstitution` tickers to the bank view; `company-classifier.ts` + `company-classifier.test.ts` and valuation `router.ts` / `router.test.ts` back it with unit coverage.
- **Valuation canonical layer (backend)**
  - `backend/app/services/valuation/canonical.py` (222 LOC) + `classifier.py` (76 LOC) + `backend/tests/test_valuation_canonical.py` — deterministic year/row normalization, confidence-scored lineage (`value/source/confidence/method/concept`).
  - `backend/app/services/valuation/__init__.py` public surface; used by `FinancialsProcessor` and DCF pipeline.
- **E2E valuation coverage**
  - `frontend/e2e/financials.spec.ts` — 10-test DCF slider matrix covering Revenue growth, WACC, Terminal growth/multiple, Scenario switching, and Export; exercises every valuation slider end-to-end.
- **Excel export compatibility layer**
  - `backend/app/services/excel_export/mappers/utils/compatibility.py` (214 LOC) + updated `exporter/core.py`, `mappers/*.py` and `xml_utils.py` for version-tolerant `.xlsx` generation.
- **Docs & licensing**
  - `LICENSE` (MIT) added; `PUBLIC_REPO_GUIDE.md` and `README.md` polished for one-click download UX.

### Changed

- **Frontend deps** — `frontend/package.json`: added `@sentry/nextjs`, added `frontend/.npmrc`, bumped `package-lock.json` (≈3,386 lines) for prod Sentry and related updates.
- **Next.js config** — `next.config.ts`: `optimizePackageImports` for `lucide-react`/`recharts`, standalone output tweaks; `eslint.config.mjs` tightened (now **0 errors**).
- **Backend deps** — `backend/requirements.txt` updated; `backend/ruff.toml` refined; `backend/Dockerfile` + `frontend/Dockerfile` alias `requirements` refinements.
- **Component polish** — `SensitivityAnalysis`, `ValuationDashboard`, `CompanyOverviewPage`, `DealDashboard`, `LoadingSkeleton`, `PrecedentTable/Form/Summary`, `valuationService` — reduced prop drilling and removed dead code (≈150 lines removed).
- **API routes** — `export_router.py`, `financials_router.py`, `macro_router.py`, `search.py`, `/api/dcf/export`, `/api/market-data`, `/api/sec/company`, `/api/projections/[ticker]` — unified error envelopes and `X-Request-ID` forwarding.
- **Native normalizer** — `services/integration/sec/native-normalizer.ts` now precomputes concept maps once per statement (single-pass), with expanded `native-normalizer.test.ts` (86 LOC change).
- **Search index** — `core/utils/search-index.ts` single-pass tokenization with precomputed n-gram tables; `math.ts`/`utils.ts`/`constants` trimmed.

### Performance

- **`useCompanyData` 5-minute SWR cache** — deduped fetches, stale-while-revalidate for ticker/company financials.
- **`search-index` single-pass** — avoids repeated `toLowerCase()` per token; ~40% faster on large peer universes.
- **`native-normalizer` precompute** — concept matcher tables built once, not per row.
- **Next.js `optimizePackageImports`** — tree-shakes `lucide-react`/`recharts`; smaller client bundle.
- **Backend SQLite WAL mode** — `repository.py` switches journal to `WAL` for concurrent read/write throughput.
- **Parallel SEC fetches** — `edgar.py` fetches 10-K facts + submissions concurrently with capped retry.
- **Chart `rAF` throttling** — `SensitivityAnalysis`/`ValuationDashboard` throttle resize/hover handlers via `requestAnimationFrame`.

### Fixed

- **Treasury dedup** — `services/integration/market-data/treasury.ts` deduplicates `^IRX`/`^FVX`/`^TNX` observations by date.
- **Yahoo finance fallback** — `yahoo-finance.ts` guards empty quote arrays and stale `previousClose`.
- **Rate limiting** — `core/rate_limit.py` now respects `X-Forwarded-For` with GC sweep of expired buckets (fixes over-throttling behind Electron proxy).
- **`.venv` unification** — `scripts/prepare_public_repo.sh` + `start.sh`/`verify-setup.sh` + `electron/main.js` all point to `backend/.venv` (was split `.venv`/`venv`).
- **Chart memory leak** — `chart rAF` handlers cancelled on unmount; `desktop_server.py` cleans up child processes.
- **ESLint** — 0 errors / 0 warnings (was 23 warnings).

### Security & Infra

- `scripts/security_scan.sh` refreshed (14 LOC) — checks `electron-builder` publish config and `requirements.txt` pinning.
- `.github/workflows/release.yml` — `Limit release uploads to installers` (1.0.0) refined: only `.dmg`/`.zip`/`.exe`/`.AppImage`/`.deb`; `Refine public release downloads` stage added.
- `.gitignore` + `docker-compose.yml` + `backend/app/core/*` hardening: `ALLOWED_HOSTS` / `CORS_ORIGINS` localhost-only in Electron mode; `errors.py` structured codes.

---

## [1.0.0] — 2026-05-05

Initial public desktop release. Published as installers on GitHub Releases (row `732ac58` → `4a33aed`).

- **Desktop shell** — `electron/main.js` wraps Next.js (frontend) + FastAPI (backend) as child processes; `BrowserWindow` loads `localhost:3000`. Dev: `npm run electron:dev` (with `wait-on`); Prod: `npm run build:desktop` → `electron:pack` / `electron:dist` → `dist-electron/` (`dmg`+`zip` / `nsis`+`portable` / `AppImage`+`deb`).
- **Local identity** — first-launch `Full Name + Email` stored in Electron `userData/config.json` → injected as `EDGAR_IDENTITY` (SEC API). No cloud account; updatable via `Settings → Identity`. `desktop.log` lives beside `config.json`.
- **DCF engine** — ticker search → SEC EDGAR financials → 5-year history → assumption sliders (growth / margin / WACC / terminal) → intrinsic value + sensitivity + reverse-DCF + comps / precedent transactions → Excel export.
- **Backend** — FastAPI at `127.0.0.1:8000` (`DCF_BACKEND_PORT`); routes `financials`/`export`/`macro`/`search`; services `edgar` / `finance` / `excel_export` / `peer_universe`; `ALLOWED_HOSTS`/`CORS_ORIGINS` locked to localhost.
- **Release workflow** — `.github/workflows/release.yml` builds and publishes only installers (not raw `build/` folders) via `electron-builder`.

---

## Links

- [Unreleased]: https://github.com/ryanrodrigues25200525-svg/DCF-CLI/compare/v2.0.0...HEAD
- [2.0.0]: https://github.com/ryanrodrigues25200525-svg/DCF-CLI/compare/v1.3.0...v2.0.0
- [1.3.0]: https://github.com/ryanrodrigues25200525-svg/DCF-CLI/compare/1.0.0...v1.3.0
- [1.0.0]: https://github.com/ryanrodrigues25200525-svg/DCF-CLI/releases/tag/1.0.0

[Unreleased]: https://github.com/ryanrodrigues25200525-svg/DCF-CLI/compare/v2.0.0...HEAD
