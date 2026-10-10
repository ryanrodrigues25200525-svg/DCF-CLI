# Fix open issues + ticker-hardcoding pilot — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close GitHub issues #41 and #40, resolve the #39/#42 merge block, and remove ticker-equality gating in one pilot vertical.

**Architecture:** Fix the #39 regression first (it blocks everything stacked on it); then single-source-of-truth the comparable median (#41), gate peer quality by filings (#40), replace ticker gates with filing-derived capability flags in the pilot vertical; NEE is a human policy decision, not code.

**Tech Stack:** TypeScript (model/src), Python/FastAPI (backend/app), vitest live suite, pytest.

**Spec:** Issue bodies of #41, #40 (via `gh issue view 41/40 --json body -q .body`); PR bodies of #39 (bisect: `ba4d588`=81/81 green, `2e79d29`=71/81), #42 (NEE decision a/b).

## Global Constraints

- Live suite gate: `cd model && npm run test:live` — target 81/81 green (current red: 10 fail on #39 branch).
- Unit gate: `cd model && npm run test:unit`; backend: `cd backend && .venv/bin/python -m pytest -q`.
- No ticker-equality (`== "X"`) in new production code; capability flags only.
- A build failing for a data reason MUST surface the reason, never opaque "An unexpected error occurred" (`backend/app/main.py:132-145`).

## Review Focus

- Even-count peer median differing between engine and mapper — expect identical median for 2/4/6/8-peer sets on both sides.
- 20-F filer with valid EV/revenue still excluded from derived peers — expect exclusion by form type, not ticker.
- Issuer with required filing schedule but unknown ticker reaches ready — expect eligibility from capability flags alone.
- Backend raising data error returns structured reason to CLI — expect CLI prints the reason string, not 500 text.
- Weak-peer set (zero industry matches) downgrades to input_required — expect status, not ready with weak peers.

---

### Task 1: Triage the #39 regression (10 live failures)

**Files:**
- Modify: `backend/app/services/valuation/classifier.py` (peer derivation path from #39)
- Modify: `model/src/cli.live.test.ts` (only if a test asserts pre-#39 contracts that #39 intentionally changed)
- Test: `cd model && npm run test:live` (failing subset)

**Interfaces:**
- Consumes: PR #39 diff (`gh pr diff 39`), failing test list on PR body.
- Produces: written triage verdict per failure: `wrong-code` (fix in Task 2) or `wrong-test` (update in this task) — posted as a PR comment.

- [ ] **Step 1: Reproduce the 10 failures on branch `fix/derive-peers-from-filings`**

Run: `cd model && npm run test:live 2>&1 | tail -30`
Expected: same 10 failures as PR body (`bridge-blocked shell`, `MU peer schedule`, `STWD/NEE blocks`, asset-manager, life, DUK/NEE, bank tests).

- [ ] **Step 2: Classify each failure as wrong-code or wrong-test**

For each: does the test assert a contract #39 intentionally changed (derived peers vs 17-name allowlist), or does production return a wrong value under the new contract? Record verdicts.

- [ ] **Step 3: Fix only the wrong-test assertions**

Update assertions to the new intended contract (derived-peer sets). Do NOT touch production code in this task.

- [ ] **Step 4: Re-run failing subset to confirm remaining failures are all wrong-code**

Run: same as Step 1. Expected: remaining failures each have a production-code cause assigned to Task 2.

- [ ] **Step 5: Commit**

```bash
git add model/src/cli.live.test.ts
git commit -m "test: update assertions to derived-peer contract (#39)"
```

### Task 2: Fix #39 wrong-code failures to green

**Files:**
- Modify: `backend/app/services/valuation/classifier.py` (`_rank_peer_details`, `_sec_filer_tickers`, readiness assembly)
- Modify: `model/src/services/valuation/multiple-model.ts` (only if median/filter mismatch lives here)
- Test: `cd model && npm run test:live`

**Interfaces:**
- Consumes: triage verdicts from Task 1.
- Produces: 81/81 green live suite on the #39 branch.

- [ ] **Step 1: Write a failing unit test per wrong-code cause**

Pin each cause at unit level (e.g. peer filter drops valid filer; median mismatch on even counts). Location: alongside existing unit tests for the touched module.

- [ ] **Step 2: Run to verify they fail**

Run: `cd model && npm run test:unit` / `cd backend && .venv/bin/python -m pytest -q -k <name>`
Expected: FAIL on the new tests.

- [ ] **Step 3: Implement minimal production fix per cause**

Keep the derived-peer coverage gain (28/41); fix the incorrect values, not the feature.

- [ ] **Step 4: Run full live suite to green**

Run: `cd model && npm run test:live`
Expected: 81/81 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/valuation/classifier.py model/src/services/valuation/multiple-model.ts
git commit -m "fix: derived-peer correctness, keep 28/41 coverage (#39)"
```

### Task 3: #41 — single source of truth for comparable median (fixes GE/OXY/NEM/CVX 500s)

**Files:**
- Modify: `model/src/services/valuation/multiple-model.ts` — emit `peersUsedForMedian: string[]` (exact tickers that produced `selectedMultiple`) in the comparable source object.
- Modify: `backend/app/services/excel_export/mappers/comparable_model.py:64-100` — consume the emitted list; delete the recompute-and-compare block (`peer_median` vs `selectedMultiple` tolerance check).
- Modify: `backend/app/api/contracts.py` — add `peers_used_for_median: list[str]` to the comparable source contract (required field).
- Modify: `model/src/api/contracts.ts` — same field on the TS side.
- Test: `EDGAR_IDENTITY=... npx tsx --tsconfig tsconfig.json src/cli.ts build GE --output /tmp/GE.xlsx` (+ OXY, NEM, CVX).

**Interfaces:**
- Consumes: `selectedMultiple: number` + `peersUsedForMedian: string[]` from engine.
- Produces: mapper writes exactly the emitted peer set; no reconciliation check remains.

- [ ] **Step 1: Write a failing test asserting mapper uses the emitted set**

```python
def test_mapper_consumes_emitted_peer_set():
    # payload where valid_peers ⊃ emitted set; mapper must write emitted set and not raise
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest -q -k mapper_consumes_emitted`
Expected: FAIL (reconciliation ValueError raised).

- [ ] **Step 3: Implement `peers_used_for_median` end-to-end (engine → contracts → mapper)**

Engine emits exact tickers; both contract layers validate; mapper filters `valid_peers` to the emitted list and uses engine `selectedMultiple` directly.

- [ ] **Step 4: Verify GE/OXY/NEM/CVX build clean**

Run: builds for all four tickers; scan every sheet for error cells (zero expected).
Expected: 4/4 build, zero Excel error cells.

- [ ] **Step 5: Commit**

```bash
git add model/src/services/valuation/multiple-model.ts model/src/api/contracts.ts backend/app/api/contracts.py backend/app/services/excel_export/mappers/comparable_model.py
git commit -m "fix: comparable median single source of truth (#41)"
```

### Task 4: #41b — surface real backend reason through CLI

**Files:**
- Modify: `backend/app/main.py:132-145` — return structured `{code, reason}` for data errors (e.g. `ValueError` from mappers) instead of generic 500.
- Modify: `model/src/cli.ts` (build path) — print `reason` to stderr on build failure.
- Test: unit test driving a mapper `ValueError` through the handler.

**Interfaces:**
- Consumes: exception from mapper/service layer.
- Produces: CLI stderr contains the reason string (e.g. "median does not reconcile…"), exit non-zero.

- [ ] **Step 1: Write failing test for structured data-error response**

Assert HTTP status + body `{code: "DATA_ERROR", reason: <message>}` for a mapper ValueError.

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest -q -k data_error_surface`
Expected: FAIL (generic 500).

- [ ] **Step 3: Implement handler split + CLI passthrough**

`ValueError` (data) → 422 with reason; unexpected → 500 unchanged. CLI prints `reason`.

- [ ] **Step 4: Run backend tests + manual trigger**

Run: `cd backend && .venv/bin/python -m pytest -q`
Expected: PASS; manual: trigger a data error, observe reason on CLI.

- [ ] **Step 5: Commit**

```bash
git add backend/app/main.py model/src/cli.ts
git commit -m "fix: surface data-error reason to CLI instead of opaque 500 (#41)"
```

### Task 5: #40 — exclude 20-F/40-F filers, add industry-match gate

**Files:**
- Modify: `backend/app/services/valuation/classifier.py` (`_sec_filer_tickers`, `_rank_peer_details`)
- Test: live build `dcf build INTC` peer set; unit tests for form-type filter.

**Interfaces:**
- Consumes: peer candidate filings metadata (form type: 10-K/10-Q vs 20-F/40-F; reporting currency; industry).
- Produces: derived peer sets contain no 20-F/40-F filers; zero-industry-match sets downgrade to `input_required` (per issue's open question — see Step 1).

- [ ] **Step 1: Confirm product decision with user (blocking question)**

Ask: (a) downgrade zero-industry-match sets to `input_required` (recommended per issue), or (b) keep `ready` with B9 provenance only. Record answer in issue #40 before coding.

- [ ] **Step 2: Write failing unit test for 20-F exclusion**

```python
def test_derived_peers_exclude_foreign_filers():
    # candidates include ASX/IFNNY (20-F); derived set must not contain them
```

- [ ] **Step 3: Run to verify it fails**

Run: `cd backend && .venv/bin/python -m pytest -q -k foreign_filers`
Expected: FAIL (ASX/IFNNY present).

- [ ] **Step 4: Implement form-type/currency filter + industry-match downgrade**

Filter on filer form type (or canonical-financials currency), not ticker presence. Apply Step-1 decision.

- [ ] **Step 5: Verify INTC set + commit**

Run: `dcf build INTC`, confirm no ASX/IFNNY; `cd backend && .venv/bin/python -m pytest -q` PASS.

```bash
git add backend/app/services/valuation/classifier.py
git commit -m "fix: exclude 20-F filers; gate weak peer sets (#40)"
```

### Task 6: Ticker-hardcode pilot — life vertical (MET/PRU → capability flags)

**Files:**
- Modify: `backend/app/services/edgar.py` (~L1685: MET segment-table branch; ~L3758-3760 conditional fetches)
- Modify: `backend/app/services/valuation/classifier.py` (~L722, L868: MET/PRU branches)
- Modify: `backend/app/api/contracts.py` (~L1847-1869, L2131-2143: MET/PRU basis/metric/segment branches)
- Modify: `backend/app/services/excel_export/mappers/life_insurance_model.py` (~L150-289, L357: ticker branches)
- Modify: `model/src/api/contracts.ts` (~L1853-1897: same branches, TS side)
- Modify: `model/src/services/valuation/life-insurance-model.ts:84` (allowlist throw)
- Modify: `model/src/services/exporters/excel/life-insurance-payload.ts:13` (allowlist throw)
- Modify: `model/src/application/run-valuation-job.ts:1135,1150` (earnings-metric branches)
- Test: existing MET/PRU live tests must pass unchanged (behavior-preserving refactor).

**Interfaces:**
- Consumes: `LifeSourceContract { earnings_basis, earnings_metric, segment_names: string[], capital_metric, dividend_capacity_group, requires_normalized_tax: boolean }` derived from filing markers, never ticker.
- Produces: identical MET/PRU workbooks; third life insurer with same schedule shape reaches `ready`/`input_required` instead of "supports only MET and PRU".

- [ ] **Step 1: Add `LifeSourceContract` registry + failing test for a third insurer**

Test: synthetic life insurer (e.g. ticker `TST`) with after-tax segment schedule → contract resolves, no "supports only" throw.

- [ ] **Step 2: Run to verify it fails**

Expected: FAIL with "supports only MET and PRU".

- [ ] **Step 3: Replace MET/PRU ticker branches with contract lookup (backend)**

`edgar.py` dispatches segment-table parse on filing markers; `classifier.py`/`contracts.py`/mapper read the contract. Keep MET/PRU outputs byte-identical.

- [ ] **Step 4: Replace MET/PRU ticker branches with contract lookup (model/src)**

Same for `contracts.ts`, `life-insurance-model.ts`, `life-insurance-payload.ts`, `run-valuation-job.ts`.

- [ ] **Step 5: Run MET/PRU live tests + unit gates**

Run: `cd model && npm run test:unit`; MET/PRU live subset; `cd backend && .venv/bin/python -m pytest -q`
Expected: all PASS, MET/PRU workbooks unchanged.

- [ ] **Step 6: Commit**

```bash
git add backend/app/services/edgar.py backend/app/services/valuation/classifier.py backend/app/api/contracts.py backend/app/services/excel_export/mappers/life_insurance_model.py model/src/api/contracts.ts model/src/services/valuation/life-insurance-model.ts model/src/services/exporters/excel/life-insurance-payload.ts model/src/application/run-valuation-job.ts
git commit -m "refactor: life vertical on filing-derived source contracts, not tickers"
```

### Task 7: NEE policy decision + #42 unstack

**Files:** none until decision made.

- [ ] **Step 1: Get user decision on NEE (blocking question)**

(a) revert `never-unsupported` override — NEE stays blocked, 2 tests pass unchanged (recommended per PR body); or (b) keep override + update the 2 tests. Record in PR #42.

- [ ] **Step 2: Apply decision, rebase #42 onto green #39, verify**

Run: `cd model && npm run test:live` → 81/81. Then merge #39 → #42 in order.

## Execution order

Tasks 1→2 (unblock) → 3, 4 (parallel) → 5 → 6 → 7. Task 4 is independent of 3 after the interface (`reason` passthrough) — can run parallel with 3. Task 5 needs the Task-1 decision answer first. Task 7 is a user question; ask it now alongside Task 5's question.
