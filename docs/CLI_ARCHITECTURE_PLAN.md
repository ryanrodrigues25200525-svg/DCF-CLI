# DCF CLI Architecture Migration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate CLI orchestration, backend data services, model eligibility, API contracts, and workbook rendering while preserving current command and workbook behavior.

**Architecture:** Python owns canonical financials and the single model-eligibility decision. The TypeScript CLI validates and consumes that decision, uses a testable valuation-job service, and keeps process/file operations in adapters. FastAPI exposes validated Pydantic contracts and injected provider ports; workbook mapping remains a formula-preserving adapter.

**Tech Stack:** Node.js 20+, TypeScript 5, Vitest, Python 3.11, FastAPI, Pydantic 2, pytest, SQLite, OpenPyXL.

**Spec:** `docs/CLI_ARCHITECTURE.md`

## Global Constraints

- Preserve the existing `dcfbuild` arguments, prompt, default output path, overwrite rule, and supported workbook routes.
- Python's canonical classifier is the only company-classification and model-eligibility implementation.
- The current verification suite is live-only: it calls current SEC, market, macro, and peer providers through the CLI using a fresh temporary cache. `EDGAR_IDENTITY` is required and is never printed or written to workbooks.
- Preserve periods, units, currency, source provenance, warnings, missing values, and dynamic fiscal-year fields through contracts.
- Preserve the checked-in workbook template, editable formulas, sheet layout, sensitivities, Data Review notes, and current short-history timeline behavior.
- Do not add frameworks, queues, databases, code generators, or runtime dependencies.
- Preserve the existing dirty worktree. Do not reset, stage, commit, or reformat unrelated files.

## Review Focus

1. Missing or unsupported `model_eligibility` must fail before a generic DCF can be generated; test missing, unknown, and blocked models in the TypeScript client/use case.
2. SEC statement rows with dynamic fiscal-year keys, `null` values, and provenance must survive Pydantic and TypeScript validation; test with the shared unified-response fixture.
3. CamelCase profile fields and snake_case native data fields must retain existing wire behavior; test both response serialization and TypeScript parsing.
4. Early backend exit, readiness timeout, already-stopped process, and output-file race must stop the child and preserve the existing file; the live suite verifies lifecycle through real CLI runs.
5. Export validation and peer enrichment must not alter formulas, warnings, source notes, or scenario centers; test workbook formulas and supported-model fixtures.

## Implementation Tasks

### Task 1: Make backend eligibility authoritative

**Files:**

- Create: `backend/app/services/valuation/model_eligibility.py`
- Modify: `backend/app/services/valuation/classifier.py`
- Modify: `backend/app/api/routers/financials_router.py`
- Create: `model/src/api/contracts.ts`
- Test: `model/src/api/contracts.test.ts`
- Modify: `model/src/core/types/native.ts`
- Modify: `model/src/services/valuation/router.ts`
- Modify: `model/src/cli.ts`
- Remove: `model/src/services/valuation/company-classifier.ts`
- Remove: `model/src/services/valuation/cli-model-support.ts`
- Test: `backend/tests/test_valuation_canonical.py`
- Test: `model/src/services/valuation/router.test.ts`
- Test: `model/src/services/integration/sec/filing-company-pipeline.test.ts`
- Remove: `model/src/services/valuation/company-classifier.test.ts`
- Remove: `model/src/services/valuation/cli-model-support.test.ts`

**Interfaces:**

- Produces `ModelEligibility` with `company_type`, `preferred_model`, `supported_by_current_engine`, `allowed_models`, and `blocked_models`.
- `calculateRoutedValuation` consumes a required validated `ModelEligibility` argument and never calls a local classifier.
- The backend classifier returns the same eligibility fields it currently places in the unified response.

- [x] **Step 1: Write failing tests** for a Python-produced eligibility result, TypeScript route following the supplied result when local profile text disagrees, and unsupported company blocking.
- [x] **Step 2: Run the focused Python and Vitest tests** and confirm they fail because TypeScript still classifies locally and the backend result is optional.
- [x] **Step 3: Add the shared eligibility contract** and update the TypeScript valuation router and CLI to require the backend result.
- [x] **Step 4: Remove duplicate TypeScript classification/support rules** and update tests to cover operating, bank, insurer, REIT, utility, high-growth, and distressed routes.
- [x] **Step 5: Run the focused Python and model tests** and confirm the supported specialist routes still use their existing formulas.

### Task 2: Validate unified-data and Excel-export contracts

**Files:**

- Create: `backend/app/api/contracts.py`
- Create: `model/src/api/backend-client.ts`
- Modify: `backend/app/api/routers/financials_router.py`
- Modify: `backend/app/api/routers/export_router.py`
- Modify: `model/src/core/types/native.ts`
- Modify: `model/src/services/exporters/excel/types.ts`
- Test: `backend/tests/test_api_contracts.py`
- Modify: `model/src/api/contracts.test.ts`
- Create: `test-fixtures/api/unified-company.json`
- Create: `test-fixtures/api/dcf-export-request.json`

**Interfaces:**

- `UnifiedCompanyResponse` includes the existing native statements, canonical financials, authoritative eligibility, market/context data, quality, completeness, and source metadata.
- `DcfExportRequest` requires company, market, historicals, assumptions, and forecasts; documented extra payload fields remain allowed.
- `BackendApiClient.getUnifiedCompany(ticker, years)` returns a parsed `NativeUnifiedPayload`.
- `BackendApiClient.exportDcf(payload)` returns validated `.xlsx` bytes or a typed error.

- [x] **Step 1: Add shared valid and invalid contract fixtures** and failing Python serialization/validation and TypeScript parse tests.
- [x] **Step 2: Run only contract tests** and confirm they fail on missing schemas/parsers or invalid input.
- [x] **Step 3: Add Pydantic response/request models** with aliases and `extra="allow"` at dynamic statement/payload nodes so fiscal-year columns and source fields are retained.
- [x] **Step 4: Add TypeScript runtime parsers** that accept `unknown`, validate required data and eligibility, retain allowed metadata, and report field paths on failure.
- [x] **Step 5: Apply response/request models to FastAPI routes** without changing URLs or existing JSON aliases.
- [x] **Step 6: Run contract tests and existing native-normalizer/export-payload tests**.

### Task 3: Add replaceable backend service ports

**Files:**

- Create: `backend/app/services/runtime.py`
- Create: `backend/app/api/dependencies.py`
- Modify: `backend/app/main.py`
- Modify: `backend/app/api/routers/financials_router.py`
- Modify: `backend/app/api/routers/macro_router.py`
- Modify: `backend/app/api/routers/search.py`
- Modify: `backend/app/api/routers/export_router.py`
- Test: `backend/tests/test_runtime_services.py`
- Test: `backend/tests/test_unified_financials_pipeline.py`
- Test: `backend/tests/test_app_health_and_rate_limit.py`

**Interfaces:**

- `RuntimeServices` contains narrow SEC, market, peer, macro, cache, and workbook ports; default adapters wrap the existing modules and SQLite repository.
- `create_app(services=None)` stores the provided or default container on app state; routes obtain it through a FastAPI dependency.

- [x] **Step 1: Write failing tests** that construct the app with fakes and prove no SEC, market, peer, macro, or workbook provider is called unless the matching route requests it.
- [x] **Step 2: Run the focused backend tests** and confirm the app currently binds to module globals.
- [x] **Step 3: Add protocols and a default service container** around the existing service modules and repository.
- [x] **Step 4: Add `create_app` and route dependencies**; inject the container into route/application functions while preserving the global `app` export.
- [x] **Step 5: Migrate provider tests from module monkeypatching to fake service ports where the boundary is being changed**; retain lower-level adapter tests.
- [x] **Step 6: Run backend tests** and confirm test fakes make no network calls.

### Task 4: Split CLI process, application job, API client, and file output

**Files:**

- Create: `model/src/application/run-valuation-job.ts`
- Create: `model/src/infrastructure/local-backend-process.ts`
- Create: `model/src/infrastructure/fetch-with-timeout.ts`
- Create: `model/src/infrastructure/output-writer.ts`
- Create: `backend/app/local_server.py`
- Modify: `model/src/cli.ts`
- Preserve/test: `model/src/cli.test.ts`
- Modify: `model/src/cli.live.test.ts`
- Create: `model/src/application/run-valuation-job.test.ts`
- Create: `model/src/infrastructure/local-backend-process.test.ts`
- Test: `model/src/infrastructure/fetch-with-timeout.test.ts`
- Create: `model/src/infrastructure/output-writer.test.ts`
- Test: `backend/tests/test_local_server.py`

**Interfaces:**

- `RunValuationJob.run({ticker, backend})` returns profile, valuation summary, warnings, and workbook bytes; `backend` is the `BackendApiClient` interface.
- `LocalBackendProcess.start()` returns a loopback base URL after a machine-readable ephemeral-port line; `stop()` is idempotent and waits for exit before forcing termination.
- The readiness request is bounded by the startup deadline; backend data/export requests time out after 60 seconds and abort their fetch.
- `writeWorkbook({path, bytes, force})` preserves `wx` no-overwrite behavior and writes only validated workbook bytes.

- [x] **Step 1: Write failing unit tests** using fake backend responses for the successful job, missing eligibility, provider-quality warnings, export HTTP failure, and malformed workbook bytes.
- [x] **Step 2: Write failing lifecycle tests** for port handshake, early exit, readiness timeout (including a hung readiness request), already-exited child, graceful stop, and forced stop.
- [x] **Step 3: Add the small Python local-server launcher** that binds loopback port zero and emits a stable port handshake before serving the existing FastAPI app.
- [x] **Step 4: Extract the local-process adapter, bounded backend client, valuation job, and output writer**; reduce `cli.ts` to arguments, prompt, lifecycle composition, and user-facing errors.
- [x] **Step 5: Preserve signal behavior and ensure every path stops the backend in `finally`**; avoid printing identity or credentials.
- [x] **Step 6: Run focused model/typecheck and backend lifecycle checks**; confirm flags, prompt, Downloads path, and overwrite behavior are unchanged.

### Task 5: Isolate peer enrichment from the workbook adapter

**Files:**

- Create: `backend/app/services/excel_export/service.py`
- Modify: `backend/app/api/routers/export_router.py`
- Test: `backend/tests/test_excel_exporter.py`
- Test: `backend/tests/test_runtime_services.py`

**Interfaces:**

- `export_workbook(payload, services)` validates/enriches an already built export request and delegates to `WorkbookPort.export(payload) -> bytes`.
- The workbook adapter accepts only a validated request dump and never imports SEC, market, peers, macro, or classification modules.

- [x] **Step 1: Record the current peer-enrichment result** with a fake peer provider and fake workbook before moving the code.
- [x] **Step 2: Move current optional peer enrichment unchanged** into the export application service and re-run the characterization test with provided, missing, duplicate, and fallback peer cases.
- [x] **Step 3: Keep the API route transport-only** and leave the template mapper focused on workbook layout and formulas.
- [x] **Step 4: Re-run formula-focused workbook tests** and inspect generic and specialist outputs for formula cells, source notes, Data Review warnings, scenario behavior, and editable input changes. Recalculated representative generated workbooks with the bundled Artifact Tool engine; no formula errors were found.

### Task 6: Update architecture and operating documentation

**Files:**

- Modify: `README.md`
- Modify: `backend/README.md`
- Modify: `API_DOCS.md`
- Modify: `API_STACK_AND_FLOW.md`
- Modify: `ARCHITECTURE_FLOW.md`
- Modify: `OPERATIONS.md`
- Modify: `PROJECT_MAP.md`
- Modify: `docs/CLI_ARCHITECTURE.md`

- [x] **Step 1: Update documentation** to match implemented module boundaries, the Python eligibility authority, validated contract fields, local backend lifecycle, supported model routes, and live test commands.
- [x] **Step 2: Review the final diff** against the existing dirty-worktree snapshot and run `git diff --check` only on edited tracked files.
- [x] **Step 3: Run final model tests, backend tests, typecheck, and workbook verification**; record exact counts, warnings, and the calculation engine used.

## Execution choice

Execute natively and sequentially in the current checkout. The work crosses shared Python/TypeScript contracts and must preserve a heavily modified, uncommitted migration; parallel agents and a new worktree would increase state and preservation risk. Do not commit or stage changes because the current repository already contains unrelated user work.

## Current test policy (user-directed)

The earlier implementation steps used deterministic fixtures and fake providers. At the user's later direction, those non-live test files and their test-only fixtures were removed. The remaining suite is `model/src/cli.live.test.ts`; it exercises live SEC, market, macro, and peer data across operating, multiple, bank, P&C, life-insurance, REIT, asset-manager, telecom, energy, pharma, biotech, utility, and unsupported cases. `npm test` in `model/` and `npm run test:backend` from the repository root run that suite and require Internet access plus `EDGAR_IDENTITY`. Each case uses an isolated temporary cache and removes its workbook after inspection.
