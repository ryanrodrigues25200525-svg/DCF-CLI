# Extensive DCF CLI Testing + Scope Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extensively test the DCF CLI on `fix/open-issues-1-8`, verify project-scope compliance, and file GitHub issues for new bugs.

**Architecture:** Read-only investigation first (no fixes without root cause per systematic-debugging). Parallel subagents own separate domains with no shared writes; coordinator integrates, reproduces, files issues, and reports evidence per verification-before-completion.

**Tech Stack:** TypeScript CLI/MCP, Python backend exporters, Bash installer, SQLite library, LibreOffice, SEC EDGAR.

**Spec:** GitHub issues #1-#20, `BUGS.md` (main), `docs/PROJECT_COMPLETION_PLAN.md` (feature branch Phases 1-6), project rules (live data, no invented values, engine deterministic, no credentials in repo, human approval for merges/releases).

## Global Constraints

- Use live EDGAR/OpenBB data for model/route claims; no fixture substitutes for provider tests.
- Missing required data stays blank/input-required; never invent valuation.
- Keep native Excel formulas editable; recalculate final workbook after OpenPyXL writes.
- AI proposals source-backed; preview separate candidate; promote only on explicit human approval.
- Valuation engine never calls LLM.
- Do not store credentials, identity strings, libraries, or workbooks in repo.
- Do not merge PRs, close issues, or publish releases without human approval.
- Tests must use temp HOME / temp models dir; never edit real HOME or real library.

## Review Focus

- CLI help/error paths that start servers or claim success on failure.
- PATH discovery that shells out or misses valid installs.
- Proposal typing that loses booleans/exponents/blanks or lets `=` through value path.
- Cover/export that guesses classification or leaks placeholders.
- Installer that writes wrong shell file or duplicates PATH lines.
- Docs that promise AI-verified builds when CLI build is deterministic-only.

---

### Task 1: Baseline gates (coordinator)

**Files:** `model/src/cli.ts`, `model/src/workbook/xlsx.ts`, `scripts/install_cli.sh`, `backend/.../cover.py`

- [ ] **Step 1: Run typecheck** `npm --prefix model run typecheck` Expected: exit 0.
- [ ] **Step 2: Run secret scan** `bash ./scripts/security_scan.sh` Expected: pass.
- [ ] **Step 3: Run diff check** `git diff --check` Expected: clean.
- [ ] **Step 4: Run filing-agent check if EDGAR_IDENTITY set** `npm --prefix model run test:filing-agent` Expected: pass or documented skip when identity unset.

### Task 2: CLI matrix (subagent A, read-only)

**Files:** `model/src/cli.ts`, `bin/dcf.mjs`, `bin/dcfbuild.mjs`

- [ ] **Step 1: Help matrix** `--help`/`-h` for top-level, `build`, `model`, `mcp`; unknown flags; missing ticker; invalid ticker. Record exit codes + first 3 output lines.
- [ ] **Step 2: Library guards** `model open/inspect/review/export` on missing ticker; `model apply` without `--approve`; `mcp --help` vs `mcp --bogus` vs `mcp extra`. Confirm no server starts on error paths.
- [ ] **Step 3: Report** Return table of command/exit/behavior + any bug with repro steps.

### Task 3: Workbook/discovery (subagent B, read-only)

**Files:** `model/src/workbook/xlsx.ts`, `model/src/review/proposal.ts`, `model/src/review/apply-service.ts`

- [ ] **Step 1: Discovery** `findBackendPython` returns openpyxl-capable python; `findSoffice` SOFFICE_PATH precedence, PATH-only fake, invalid rejected, hung fails fast with timing.
- [ ] **Step 2: Proposal types** boolean/exponent/blank validate; `=`-value rejected; `toCellEdit` blank writes null key present.
- [ ] **Step 3: Report** Return evidence + any bug with repro steps.

### Task 4: Backend export + installer (subagent C, read-only)

**Files:** `backend/app/services/excel_export/mappers/cover.py`, `scripts/install_cli.sh`, `scripts/prepare_public_repo.sh`

- [ ] **Step 1: Cover** missing industry/sector -> `Not disclosed`; provided preserved; no `Technology` fallback; author/contact cleared when absent.
- [ ] **Step 2: Installer** temp-HOME bash/zsh/other, idempotence, symlink safety, PATH-already-present skip.
- [ ] **Step 3: Report** Return evidence + any bug with repro steps.

### Task 5: Scope compliance (coordinator)

- [ ] **Step 1: Re-read** `docs/PROJECT_COMPLETION_PLAN.md` Phases 1-6 project rules + issues #18/#20.
- [ ] **Step 2: Check** no credentials/identity/workbooks/DBs tracked (`git status`, `git ls-files | grep -Ei 'edgar|identity|\.db|\.sqlite|current\.xlsx|companies/'`).
- [ ] **Step 3: Check** docs do not claim standalone `dcf build` is AI-verified; engine has no LLM calls (`grep -ri 'openai\|anthropic\|llm' model/src/services backend/app/services || true`).
- [ ] **Step 4: Record** gaps as scope notes, not code changes.

### Task 6: File new issues (coordinator)

- [ ] **Step 1: Reproduce each candidate bug** minimally on current branch.
- [ ] **Step 2: Search existing open issues** to avoid duplicates (`gh issue list`, `gh search issues`).
- [ ] **Step 3: Create issue** via `gh issue create` with title `[Bug] ...`, repro steps, expected/actual, evidence, scope impact.
- [ ] **Step 4: Report** new issue numbers + URLs; do not close #1-#20 or merge PRs.
