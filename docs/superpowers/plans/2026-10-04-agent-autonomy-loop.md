# Agent Autonomy Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the agent loop: auto-review hook on staging, revision comparison, and MCP-triggered builds, so the agent verifies and the human decides.

**Architecture:** Deterministic services own bytes and checks; the hook is an advisory shell-out whose output is stored distinctly from the required AI verification; compare reads archived revision bytes (hash-verified) plus the pending candidate; MCP reuses the same services as the CLI via dynamic imports with specific error codes.

**Tech Stack:** TypeScript/Node.js CLI + stdio MCP, Python/openpyxl inspection, SQLite library, LibreOffice recalc, Vitest (explicit file runs).

**Spec:** User vision 2026-10-04 (agent verifies + fixes irregularities, human decides; refresh on new filings; compare same-company revisions) plus Phase 5 exit criteria in `docs/PROJECT_COMPLETION_PLAN.md` (feature branch).

## Global Constraints

- Valuation engine never calls an LLM; hook output is advisory and never counts as the required verification.
- Missing data stays blank/input-required; never invent values.
- Human approval (`--approve` / `approval=true`) is the only promotion path.
- Tests use temp HOME/models dirs; never touch real HOME or library.
- Live tests use live SEC data; no fixture providers and no mock LLM.
- No merges, closes, or releases without human approval.

## Review Focus

- A hook command that hangs or writes to stdout endlessly blocking staging — bound it (timeout + output cap) and never fail staging on hook failure.
- A compare range where one side is missing (no archive, diverged current) failing closed with a named error instead of inventing a diff.
- An MCP build call holding the stdio loop for minutes surprising clients — document the long-runtime contract in the tool description.
- A verification adopted silently from hook output counting as AI review — keep autoReview and verification as separate payload fields, require verification explicitly.
- A refresh that maps no new facts silently claiming update — candidate inspect must say the model is not updated with an unmapped period.

---

### Task 1: Candidate inspection enrichment (auto-review content)

**Files:**
- Modify: `model/src/review/build-candidate.ts` (inspect candidate workbook in view)
- Modify: `model/src/cli.ts` (show inspection in `model candidate` output)
- Test: `model/src/agent-loop.unit.test.ts` (synthetic workbook, no network)

**Interfaces:**
- Consumes: `inspectWorkbook(python, path)` from `@/workbook/xlsx`
- Produces: `CandidateView.inspection: { sheets, formulaCount, cachedErrors, inputRequired } | null`

- [ ] **Step 1: Write the failing test** — stage a synthetic candidate in a temp lib, assert `getPendingCandidateView().inspection` reports sheet list + formula count + zero cached errors.
- [ ] **Step 2: Run it to verify it fails** — Run: `vitest run src/agent-loop.unit.test.ts` Expected: FAIL (no `inspection` field).
- [ ] **Step 3: Implement inspection in `toView()`** — run `inspectWorkbook` on the candidate path when engines exist, else `null`; never throw when engines are absent.
- [ ] **Step 4: Run test to verify it passes** — same command. Expected: PASS.
- [ ] **Step 5: Commit** — `git add model/src/review/build-candidate.ts model/src/agent-loop.unit.test.ts; git commit -m "feat: inspect candidate workbooks for auto-review"` .

### Task 2: Review hook config + invocation

**Files:**
- Modify: `model/src/library/config.ts` (get/set review-hook command)
- Modify: `model/src/review/build-candidate.ts` (`runReviewHook()` + `autoReview` payload field)
- Modify: `model/src/cli.ts` (`config review-hook`, invoke after staging, show in candidate output)
- Test: `model/src/agent-loop.unit.test.ts` (hook `/usr/bin/true` records exit 0; failing hook records without failing staging; hanging hook bounded by timeout)

**Interfaces:**
- Consumes: Task 1 view shape
- Produces: `runReviewHook(workbookPath, env): { command, exitCode, output, timedOut }`; config `getReviewHook()/setReviewHook()`; CLI `dcf config review-hook [--set <cmd>]`

- [ ] **Step 1: Write failing tests** — hook true/false/timeout env propagation (`DCF_TICKER`, `DCF_CANDIDATE_ID`, `DCF_WORKBOOK`).
- [ ] **Step 2: Run to verify they fail** — same vitest command. Expected: FAIL (functions missing).
- [ ] **Step 3: Implement** — 120s timeout, 8KB output cap, env above, advisory-only (staging never fails on hook).
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 3: Revision comparison

**Files:**
- Create: `model/src/review/revision-compare.ts` (`compareWorkbooks(before, after)` via openpyxl, bounded; `resolveCompareEndpoints()` for rev ids + `accepted`/`candidate` aliases with hash verification)
- Modify: `model/src/cli.ts` (`dcf model compare <ticker> [--from R] [--to R]`)
- Modify: `model/src/mcp/server.ts` (`revision_compare` tool)
- Test: `model/src/agent-loop.unit.test.ts` (synthetic pair: added/removed sheets, changed formula, changed value, identical → zero changes)

**Interfaces:**
- Consumes: `findBackendPython()`; revision archives + candidate path
- Produces: `compareWorkbooks(beforePath, afterPath, {limit}) -> {addedSheets, removedSheets, changes[{sheet,cell,kind,before,after}], truncated}`; CLI + MCP surface

- [ ] **Step 1: Write failing tests** — five synthetic-pair assertions above.
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL (module missing).
- [ ] **Step 3: Implement** — python one-shot diff (formulas via data_type, cached values data_only), cap 200 changes detail.
- [ ] **Step 4: Run tests** — Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 4: MCP-triggered builds via shared service

**Files:**
- Modify: `model/src/review/build-candidate.ts` (extract `runBuildStaging({lib, root, ticker, fetch})` used by both CLI and MCP; CLI keeps all printing)
- Modify: `model/src/mcp/server.ts` (`model_build` tool, long-runtime contract in description)
- Test: live-only (`model/src/build-candidate.live.test.ts` add: MCP `model_build` over stdio on temp lib stages a candidate)

**Interfaces:**
- Consumes: Tasks 1-2 service functions
- Produces: `runBuildStaging()` returning `{candidateId, hash, route, readiness, accession, exportPath}`; MCP `model_build {ticker, output?}`

- [ ] **Step 1: Write the failing live test** — stdio `model_build` for AAPL on temp lib asserts staged candidate row + no accepted publish.
- [ ] **Step 2: Run to verify it fails** — Expected: FAIL (unknown tool).
- [ ] **Step 3: Implement** — extract + tool with `BUILD_FAILED`/`ENGINE_UNAVAILABLE` codes.
- [ ] **Step 4: Run test** — Expected: PASS.
- [ ] **Step 5: Commit.**

### Task 5: Docs + live proof

**Files:**
- Modify: `README.md`, `docs/MODEL_LIBRARY.md`, `OPERATIONS.md`, `CHANGELOG.md`, `.superpowers/skills/dcf-model-review/SKILL.md`
- Test: `vitest run src/build-candidate.live.test.ts` + one live AAPL refresh compare demo via CLI

- [ ] **Step 1: Document** hook/compare/MCP-build in all five docs.
- [ ] **Step 2: Live compare demo** — temp lib: build→verify→accept, update→verify→accept, `model compare` shows the inter-revision diff.
- [ ] **Step 3: Commit.**
