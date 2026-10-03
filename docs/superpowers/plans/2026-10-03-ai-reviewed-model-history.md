# AI-Reviewed DCF Model History — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (or superpowers:executing-plans) to implement this plan task-by-task. Steps use checkbox syntax.

**Goal:** Make each dated DCF revision auditable and comparable, let the AI write reviewed edits into a validated candidate workbook with an `AI Change Log` sheet, and keep the accepted model unchanged until human approval.

**Architecture:** Extend the existing SQLite revision library with filing and event metadata. A shared comparison service reads immutable workbook revisions and source snapshots for CLI and read-only MCP tools. AI proposals are applied to a separate candidate copy, recalculated and validated, then promoted through the existing approval path; the AI Change Log records the summary, cell-level changes, sources, and checks.

**Tech Stack:** TypeScript, Node.js 22+, SQLite, Python 3.11, OpenPyXL, LibreOffice, Vitest live CLI suite.

**Spec:** User-approved design in the 3 October 2026 conversation; existing contracts and safety rules in `docs/MODEL_LIBRARY.md` and `.superpowers/skills/dcf-model-review/SKILL.md`.

## Global Constraints

- Keep the live-only model suite; do not add fixture-only provider tests.
- Never overwrite the accepted workbook while creating or reviewing a candidate.
- Every applied cell change must include a prior value/formula, proposed value/formula, rationale, and filing/source reference.
- Candidate and accepted workbook formulas remain editable native Excel formulas.
- A candidate is promoted only by the existing explicit human approval step.
- Report the filing period actually mapped into the workbook; do not describe an annual-only model as updated with a new quarter.
- Do not add AI API credentials or call an external LLM from the Python/TypeScript valuation engine.
- OpenCode Go agents use the selected Muse Spark 1.3 Contributor or DeepSeek V4.1 Flash models; agents do not push to `main`.

## Review Focus

1. A filing can be newer than the period mapped into an annual-only model; compare output must show both accessions/periods.
2. Formula edits and literal edits must both appear in the AI Change Log with accurate old/new values.
3. Candidate generation, validation failure, rejection, and promotion must preserve the accepted revision unless approval succeeds.
4. Old library databases without new revision metadata must remain readable through an idempotent migration.
5. Input-required models and unsupported routes must retain their existing no-value/fail-closed behavior.

---

### Task 1: Fix the confirmed CLI issues

**Files:** `model/src/cli.ts`, `model/src/cli.live.test.ts`

- [ ] Add live CLI regressions for accurate workbook-open status, typed proposal values (boolean, exponent, explicit blank), and `dcf mcp --help`/invalid arguments.
- [ ] Run the focused live regressions and confirm each exposes the current behavior.
- [ ] Implement the smallest fixes without changing the normal successful command paths.
- [ ] Re-run the focused live cases and typecheck.
- [ ] Link to GitHub Issues #1, #3, and #8 in the PR.

### Task 2: Fix platform discovery and cover metadata

**Files:** `model/src/workbook/xlsx.ts`, `scripts/install_cli.sh`, `backend/app/services/excel_export/mappers/cover.py`, live CLI checks as applicable.

- [ ] Trace interpreter, LibreOffice, shell-startup, and cover metadata fallbacks; preserve explicit `SOFFICE_PATH` precedence and installer idempotence.
- [ ] Add regression checks that can run on the current host without editing the real home directory.
- [ ] Implement Windows `python`/LibreOffice PATH candidates, POSIX PATH lookup without `which`, shell-appropriate login PATH setup, and an honest missing-industry cover label.
- [ ] Run available live checks; record Windows-only behavior that cannot be executed on this macOS host.
- [ ] Link to GitHub Issues #2, #4, #5, #6, and #7 in the PR.

### Task 3: Persist filing context and compare revisions

**Files:** `model/src/library/types.ts`, `model/src/library/store.ts`, `model/src/workbook/xlsx.ts`, `model/src/cli.ts`, `model/src/mcp/server.ts`, `model/src/cli.live.test.ts`.

- [ ] Add revision metadata for build event, fact accession/period, latest detected filing (form/accession/filed/report date), route/readiness, and build timestamp; migrate existing databases safely.
- [ ] Add a shared read-only comparison service for formula/value cell changes plus source and model-readiness deltas.
- [ ] Add `dcf model compare <ticker> [--from <revision>] [--to <revision>] [--json]` and MCP revision-list/compare tools that return the same data.
- [ ] Add live tests that build two revisions in an isolated library, compare them, and verify the old revision and accepted workbook remain readable.

### Task 4: Create a validated AI candidate and change log

**Files:** `model/src/review/apply-service.ts`, `model/src/cli.ts`, `model/src/mcp/server.ts`, `backend/app/services/excel_export/` workbook edit helper, `model/src/cli.live.test.ts`.

- [ ] Add a proposal-preview operation that applies the structured AI proposal to a separate candidate copy and adds an `AI Change Log` sheet with the AI summary, each changed sheet/cell, prior/proposed value or formula, rationale, source accession, and validation result.
- [ ] Recalculate and validate the candidate before returning it; any error leaves the accepted workbook and revision metadata untouched.
- [ ] Keep promotion behind the existing explicit approval command/tool; rejection leaves the accepted workbook unchanged.
- [ ] Add live tests for candidate formula/value edits, the change-log sheet, validation failure, rejection, and approved promotion.

### Task 5: Make AI review repeatable and provide sample workbooks

**Files:** `.superpowers/skills/dcf-model-review/SKILL.md`, `README.md`, `docs/MODEL_LIBRARY.md`, `docs/MODEL_COVERAGE.md`, `BUGS.md`, `.gitignore`, `examples/`.

- [ ] Update the review workflow so every new build/update is inspected, compared with its prior revision when one exists, and summarized by ChatGPT/Codex using stored source references before any proposal is promoted.
- [ ] Generate dated live examples for AAPL, JPM, XOM, and input-required DUK; record build date, model route, source accession, and mapped period in `examples/README.md`.
- [ ] Whitelist only `examples/*.xlsx` in `.gitignore`; keep model-library databases, identity strings, and user workbooks out of the repository.
- [ ] Update issue links/status and document the current comparison command, AI change sheet, approval workflow, and route freshness limits.

### Task 6: Final live verification and PR

- [ ] Run the full live model suite, live filing-agent check, typecheck, security scan, and workbook recalculation/inspection on representative ready and input-required examples.
- [ ] Verify formula counts, cached formula errors, source references, candidate/accepted hashes, and editable formula behavior.
- [ ] Review the complete diff and `git diff --check`; report Windows/macOS-specific checks that could not be run locally.
- [ ] Open one PR linked to Issues #1–#8; do not merge it automatically.
