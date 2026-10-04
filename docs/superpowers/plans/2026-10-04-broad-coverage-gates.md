# Broad Coverage: Fewer Gates, Same Honesty Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Most S&P-scale companies build valued models; gates block only genuinely unvaluable cases.

**Architecture:** Measure readiness across a ~30-ticker universe first, then fix by blocker class: drop route-irrelevant requirements, confirm fallback data via analyst inputs, map missing filed concepts where the SEC actually reports them. Never invent values; every relaxed gate keeps a fail-closed default.

**Tech Stack:** TypeScript classifier/eligibility + job routing, Python backend normalizer/classifier, live SEC + OpenBB, Vitest live tests.

**Spec:** User directive 2026-10-04 (models for most companies; fix edge-case gates) plus the MU precedent (fallback peers confirmable, operating keys scoped).

**Status (2026-10-04):** Tasks 1–4 executed. Sweep: ready 10 → 16+, with remaining input-required states staged as analyst-confirmable schedules. Mapping fixes: combined cash/STI legs, companyfacts fallbacks (cash, current/long-term debt incl. capital/finance-lease variants, NCI, CapEx, D&A, property-plant), genuine-absence proofs (marketable securities, NCI), PP&E-rollforward CapEx, stub-year carry-forward. Route fixes: comparable median peer-set reconciliation, revenue-multiple EBITDA leak, semiconductor-before-energy archetype order. Specialized-archetype multiple fallback added for energy/pharma/unsupported-financial/unclassified (multiple route only; specialist block reason retained). Task 5 pending full-suite green + final sweep.

## Global Constraints

- Never invent values: unconfirmed or absent data withholds valuation, never guesses.
- Every relaxed gate keeps analyst confirmation or a fail-closed default.
- Live SEC/OpenBB data for all verification; no fixture providers.
- Existing green tests stay green (CAT/SNOW ready routes, TGT shell, MU schedule).
- Tests use temp dirs; no merges/closes/releases without human approval.

## Review Focus

- A newly mapped concept misreading units (millions vs actuals) silently inflating a valuation — map with unit checks and pin with per-ticker assertions.
- A fallback confirmation that auto-passes without analyst action — confirmations require explicit entry, never defaults.
- A route downgrade (e.g. operating → multiple) chosen just to produce a number — route selection stays data-driven, downgrades explicit and labeled.
- A relaxed freshness window admitting stale multiples — 24h peer freshness stays.
- An unmapped sector (e.g. conglomerates, staples specifics) falling through to unsupported — report as gap, don't force a route.

---

### Task 1: Universe readiness measurement

**Files:**
- Create: `/tmp/dcf_coverage_sweep.ts` (throwaway probe, not committed)
- Test: manual run, results pasted into the tracking issue

**Interfaces:**
- Consumes: `runValuationJob(ticker, client)`, `BackendApiClient`
- Produces: per-ticker `{route, readiness, gapKeys[], error?}` table for ~30 tickers

- [ ] **Step 1: Write the sweep probe** — temp cache DB, sequential tickers, 90s per-ticker budget, JSONL output.
- [ ] **Step 2: Run it in background** — Run: `tsx sweep.ts > sweep.jsonl` Expected: completes with a row per ticker.
- [ ] **Step 3: Classify blockers** — group tickers by gap-key sets; name each class.
- [ ] **Step 4: File/update tracking issue** with the table.

### Task 2: Fix route-irrelevant requirements (per class from Task 1)

**Files:**
- Modify: `model/src/application/run-valuation-job.ts` (`buildIncompleteInputRequirements` skip rules)
- Test: `model/src/cli.live.test.ts` (per-class assertions on live tickers)

**Interfaces:**
- Consumes: Task 1 blocker classes
- Produces: requirements containing only route-consumed keys per model

- [ ] **Step 1: Write failing live assertions** — blocked ticker's requirements contain only route-relevant keys.
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL with leaked keys.
- [ ] **Step 3: Extend skip rules per class** — one model family at a time, minimal sets.
- [ ] **Step 4: Run tests green** — new + CAT/SNOW/TGT/MU suites.
- [ ] **Step 5: Commit.**

### Task 3: Confirmable fallbacks (per class from Task 1)

**Files:**
- Modify: `model/src/application/run-valuation-job.ts`, `model/src/api/contracts.ts`, `backend/app/api/contracts.py`, route mappers as needed
- Test: `model/src/cli.live.test.ts`

**Interfaces:**
- Consumes: Task 1 fallback-blocked classes
- Produces: confirmation-schedule workbooks where data exists to confirm

- [ ] **Step 1: Write failing live assertions** — fallback-blocked ticker yields confirmation inputs, not a bare shell.
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL (shell).
- [ ] **Step 3: Implement** — mirror the MU precedent (requirements + mapper acceptance + contract parity).
- [ ] **Step 4: Run tests green** — new + full comparable/regression set.
- [ ] **Step 5: Commit.**

### Task 4: Missing filed-concept mapping (per class from Task 1)

**Files:**
- Modify: `backend/app/services/` normalizer/classifier for the specific concept(s)
- Test: `model/src/cli.live.test.ts` (filed value appears with accession)

**Interfaces:**
- Consumes: Task 1 unmapped-concept classes
- Produces: mapped lines with unit checks

- [ ] **Step 1: Write failing live assertions** — concept present with source + accession.
- [ ] **Step 2: Run to verify they fail** — Expected: FAIL (unmapped).
- [ ] **Step 3: Implement mapping** — one concept at a time with unit validation.
- [ ] **Step 4: Run tests green.**
- [ ] **Step 5: Commit.**

### Task 5: Release the coverage gains

**Files:**
- Modify: `CHANGELOG.md` (Unreleased), examples for newly-valued tickers
- Test: `npm run test:model` full green + format guard on new examples

- [ ] **Step 1: Run full suite** — Expected: all green.
- [ ] **Step 2: Rebuild examples** for newly valued tickers through the gate.
- [ ] **Step 3: PR + merge + close issues** — human-approved.
