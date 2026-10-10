# Fix All Open Issues Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close all 23 open GitHub issues (P1 ready-path chain, EDGAR fetch gates, peer fallback/median, export correctness, docs/process) with failing-tests-first fixes.

**Architecture:** Fix at source per layer: backend EDGAR fetch predicates widen to classifier predicates; peer `fallback_used` includes hardcoded table; model router gains life case + keeps forecasts + hasForecast gates; run-valuation-job builds/passes utility-biotech-life historicals and branches exports; export/UX guards corrected; docs register refreshed.

**Tech Stack:** TypeScript (vitest `*.unit.test.ts`), Python FastAPI backend (pytest), SEC EDGAR via edgartools, yfinance/stockdex peers, openpyxl/LibreOffice workbook export.

**Spec:** GitHub issues #40-#63 (bodies fetched 2026-10-08) + `BUGS.md` register + `docs/plans/2026-10-06-fix-issues-and-ticker-hardcoding.md`. Executors read issue bodies as spec authority.

## Global Constraints

- Ticker-free routing only: no new ticker-equality gates.
- Source discipline: no valuation without filed facts; hardcoded peers never enter ready median without analyst confirmation.
- TDD for every fix: failing test first, watch it fail, minimal fix, full suite green.
- Frequent commits, one task per commit range.
- `npm test` = unit suites only (no network/`EDGAR_IDENTITY`); `npm run test:live` stays opt-in.

## Review Focus

- Description-identified filer with SIC 0/9999 but energy/pharma/biotech/telecom/asset-manager language still fetches specialist facts and routes.
- Derived screener set with 0 industry matches is flagged fallback and blocked from ready median until confirmed.
- Ready utility/biotech/life valuations return `isValuationSupported=true` only with non-empty canonical `forecasts`.
- Pre-revenue biotech with real pipeline assets reaches RNPV instead of `input_required` on revenue gate.
- Comparable export 500 no longer fires when engine peer set (GE/OXY/NEM/CVX shape) round-trips through contracts to mapper.

---

### Task 1: EDGAR specialist fetch gates (#61, #62, #46)

**Files:**
- Modify: `backend/app/services/edgar.py:3825-3836`
- Modify: `backend/app/services/edgar.py:3712-3722` (helpers only if needed)
- Test: `backend/tests/test_edgar_fetch_gates.py` (new) or extend existing edgar unit test

**Interfaces:**
- Consumes: classifier predicates — biotech `description has biotech/biotechnology/biopharmaceutical OR sic==2836`, pharma `description has pharma/pharmaceutical/drug manufacturer OR sic in {2833,2834,2835}`, telecom `description has telecom/wireless carrier/wireless telecommunication OR sic in {4812,4813}`, asset-manager `industry contains 'asset management' OR filed AUM fact`, energy `_is_energy_filer` SIC ranges.
- Produces: `financials_native.{asset_management_filing_facts, telecom_filing_facts, energy_filing_facts, pharma_filing_facts, pipeline_assets}` populated for description-identified filers; telecom includes SIC 4812.

- [ ] **Step 1: Write the failing test**

```python
def test_description_identified_biotech_fetches_pipeline():
    # company stub: sic="9999", sic_description="biotechnology company", industry="Biotechnology"
    # assert _fetch_biotech_pipeline_assets called / pipeline_assets non-empty via gate predicate
    assert gate_allows_biotech(company) is True

def test_asset_manager_industry_gate():
    # sic="9999", industry="Asset Management"
    assert gate_allows_asset_manager(company) is True

def test_telecom_4812_fetch():
    # sic="4812"
    assert gate_allows_telecom(company) is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_edgar_fetch_gates.py -v`
Expected: FAIL — gates return False for description/industry/4812 cases.

- [ ] **Step 3: Implement gate widening in `backend/app/services/edgar.py:3825-3836`**

Widen each fetch `if` to classifier predicate (SIC OR description/industry text). Extract small `_describe(company)` helper reusing classifier token logic; do not add ticker checks. Telecom condition becomes `sic in {"4812","4813"} or description-match`. Asset-manager becomes `sic in {"6211","6282"} or "asset management" in industry.lower()`. Biotech/pharma/energy use `_is_*_filer(company) or description-match`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_edgar_fetch_gates.py -v`
Expected: PASS. Then `python -m pytest tests/ -q` (or at least finance/valuation subset) green.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/edgar.py backend/tests/test_edgar_fetch_gates.py
git commit -m "fix(edgar): widen specialist fetch gates to classifier predicates (#61, #62, #46)"
```

### Task 2: Peer fallback flag + median guard (#60, #40 remainder, #41 verify, #49)

**Files:**
- Modify: `backend/app/services/finance/peers.py:522-528`
- Modify: `backend/app/services/excel_export/mappers/comparable_model.py:40-49`
- Modify: `backend/app/services/finance/precedent_transactions.py` (or wherever SOFTWARE fallback lives, per #49)
- Test: `backend/tests/test_peer_fallback_flag.py`

**Interfaces:**
- Consumes: `candidate_source in {"sector_industry_table","derived_screener","default_symbols","unavailable","symbol_only_fallback"}`, `industry_matches`, `used_symbol_fallback`.
- Produces: `fallback_used=True` for `sector_industry_table` and zero-industry-match derived sets; comparable ready guard rejects fallback sets; precedent transactions return sector-specific or explicit unsupported instead of SOFTWARE default.

- [ ] **Step 1: Write the failing test**

```python
def test_sector_table_is_fallback():
    bundle = build_bundle(candidate_source="sector_industry_table")
    assert bundle["fallback_used"] is True

def test_zero_industry_derived_is_fallback():
    bundle = build_bundle(candidate_source="derived_screener", industry_matches=0)
    assert bundle["fallback_used"] is True
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest tests/test_peer_fallback_flag.py -v`
Expected: FAIL with `fallback_used is False`.

- [ ] **Step 3: Implement `fallback_used` widening in `peers.py:522-528`**

Add `candidate_source == "sector_industry_table"` to the `fallback_used` OR condition (and keep `weak_derived_set` for zero-industry derived). Verify comparable mapper guard (`peerFallbackUsed is False`) now blocks table sets. Fix precedent-transaction fallback to return sector-mapped or raise DATA_ERROR instead of SOFTWARE comps.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest tests/test_peer_fallback_flag.py tests/test_peers*.py -v`
Expected: PASS, fallback sets blocked from ready median.

- [ ] **Step 5: Commit**

```bash
git add backend/app/services/finance/peers.py backend/app/services/excel_export/mappers/comparable_model.py backend/tests/test_peer_fallback_flag.py
git commit -m "fix(peers): flag sector-table peers as fallback, block from ready median (#60, #40)"
```

### Task 3: Router ready-path — life case, forecasts, hasForecast gates (#45, #43-part, #58, #59)

**Files:**
- Modify: `model/src/services/valuation/router.ts:16-228`
- Modify: `model/src/services/valuation/utility-model.ts:104-125`, `life-insurance-model.ts:148-220`, `telecom-model.ts:527-548`
- Test: `model/src/services/valuation/router.unit.test.ts`

**Interfaces:**
- Consumes: `eligibility.preferred_model`, `utilityModelInput: UtilityModelAssumptions`, `biotechModelInput: BiotechRnpvAssumptions`, `lifeModelInput: {historical, assumptions}` (new).
- Produces: `DCFResults` with populated canonical `forecasts` for utility/biotech/life/telecom; `isValuationSupported = forecasts.length > 0`; new `life_insurer_distributable_earnings_dcf` case.

- [ ] **Step 1: Write the failing test**

```typescript
test('life route returns supported with forecasts', () => {
  const r = calculateRoutedValuation(h, a, {}, {preferred_model:'life_insurer_distributable_earnings_dcf', supported_by_current_engine:true, allowed_models:['life_insurer_distributable_earnings_dcf']} as any, undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined,undefined, lifeInput);
  expect(r.isValuationSupported).toBe(true);
  expect(r.forecasts.length).toBeGreaterThan(0);
});
test('utility supported requires forecasts', () => {
  const r = calculateRoutedValuation(/* utility input with empty forecasts */);
  expect(r.isValuationSupported).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd model && npx vitest run src/services/valuation/router.unit.test.ts`
Expected: FAIL — life falls to default unsupported; utility supported with `forecasts: []`.

- [ ] **Step 3: Implement in `router.ts`**

Add `lifeModelInput` param + `case 'life_insurer_distributable_earnings_dcf'` mirroring bank/insurance. Stop `{...result, forecasts: []}` wipes for utility/biotech (map sidecars into canonical forecasts or keep engine forecasts). Gate utility/biotech/life supported-ness on `forecasts.length > 0` like `unlevered_dcf`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd model && npx vitest run src/services/valuation/router.unit.test.ts`
Expected: PASS. Then `npm test` green.

- [ ] **Step 5: Commit**

```bash
git add model/src/services/valuation/router.ts model/src/services/valuation/router.unit.test.ts
git commit -m "fix(router): life case, keep specialist forecasts, gate supported on forecasts (#45, #58, #59)"
```

### Task 4: run-valuation-job — build/pass utility-biotech-life + export branches + revenue exempt (#43, #54, #57)

**Files:**
- Modify: `model/src/application/run-valuation-job.ts:1902-1904, 2066-2144, 2156-2183`
- Modify: `model/src/services/exporters/excel/` (add utility/biotech/life payload builders or reuse incomplete-model builders for ready path)
- Test: `model/src/application/run-valuation-job.unit.test.ts`

**Interfaces:**
- Consumes: `data.canonical_financials`, `eligibility.preferred_model`, builders `mapCanonicalUtility/ Biotech/Life...`, `buildSourced...Assumptions`.
- Produces: `calculateRoutedValuation` called with trailing `utilityModelInput, biotechModelInput, lifeModelInput`; ready `exportPayload` uses specialist builders; `requirePositiveRevenue` exempts `biotech_pipeline_rnpv` (+ life if revenue-independent).

- [ ] **Step 1: Write the failing test**

```typescript
test('passes utility input through to router', async () => {
  // eligibility preferred_model='utility_dcf', spy on calculateRoutedValuation trailing args
  expect(captured.utilityModelInput).toBeDefined();
});
test('pre-revenue biotech not blocked', async () => {
  // canonical with zero revenue + pipeline assets, preferred_model='biotech_pipeline_rnpv'
  expect(buildModelInputs).not.toThrow();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd model && npx vitest run src/application/run-valuation-job.unit.test.ts`
Expected: FAIL — trailing args undefined; revenue gate throws.

- [ ] **Step 3: Implement in `run-valuation-job.ts`**

Build `utilityHistorical/Assumptions`, `biotechHistorical/Assumptions`, `lifeHistorical/Assumptions` when `preferred_model` matches (mirroring bank/insurance pattern); pass as trailing args to `calculateRoutedValuation`; add `utilityHistorical/biotechHistorical/lifeHistorical` export branches calling specialist payload builders; extend `requirePositiveRevenue` exempt list with `biotech_pipeline_rnpv`.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd model && npx vitest run src/application/run-valuation-job.unit.test.ts && npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add model/src/application/run-valuation-job.ts model/src/application/run-valuation-job.unit.test.ts
git commit -m "fix(job): wire utility-biotech-life ready path and exports (#43, #54, #57)"
```

### Task 5: Export + backend correctness sweep (#55, #53, #50, #49, #44, #47, #63)

**Files:**
- Modify: `model/src/application/run-valuation-job.ts:1812` (`asOfDate`), `backend/app/main.py` (500 handler), `backend/app/services/finance/peers.py` + specialist parsers, `model/src/application/run-valuation-job.ts` warning propagation, `backend/app/services/valuation/canonical.py` (preferred_equity NCI proof), biotech comparable fallback label.
- Test: `model/src/application/export-guard.unit.test.ts` + `backend/tests/test_export_correctness.py`

**Interfaces:**
- Consumes: `data.valuation_context.as_of_date`, backend exception types, peer quality record.
- Produces: export `asOfDate` = valuation context date; 500s include correlation id + reason; specialist parsers accept foreign/IFRS units with scaling notes or explicit unsupported; precedent transactions never default to SOFTWARE; biotech unsupported stages comparable fallback without hardcoded MRNA label; all specialist warnings propagate (not just asset_manager); preferred-equity `not_applicable` requires filed-source proof like securities/NCI.

- [ ] **Step 1: Write the failing tests**

```typescript
test('export asOfDate uses valuation context', () => { expect(payload.asOfDate).toBe(ctx.as_of_date); });
```

```python
def test_500_includes_reason():
    assert "reason" in json.loads(handler(exc).body)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd model && npx vitest run src/application/export-guard.unit.test.ts; cd ../backend && python -m pytest tests/test_export_correctness.py -v`
Expected: FAIL — wall-clock date used; 500 body opaque.

- [ ] **Step 3: Implement fixes file-by-file, smallest first**

asOfDate → `data.valuation_context.as_of_date`; 500 handler → structured `{code, reason, correlationId}`; warnings spread for every specialist branch; biotech fallback label from peer set not constant; preferred_equity proof check mirrors NCI.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd model && npm test; cd ../backend && python -m pytest tests/ -q`
Expected: PASS, no regressions.

- [ ] **Step 5: Commit**

```bash
git add model/src/application/run-valuation-job.ts backend/app/main.py backend/app/services/valuation/canonical.py
git commit -m "fix(export): context asOfDate, transparent 500s, warning + fallback correctness (#55, #53, #47, #44, #63, #50, #49)"
```

### Task 6: Docs register + process + verification (#52, #51, #48)

**Files:**
- Modify: `BUGS.md`, `CHANGELOG.md`
- Test: manual — `gh issue list --state open`, `npm test`, `python -m pytest`, `npx tsc --noEmit`

**Interfaces:**
- Consumes: `gh issue list --state open`, `gh pr list --state open` output.
- Produces: `BUGS.md` tracker snapshot dated 2026-10-08 with 23-issue table deltas; CHANGELOG Unreleased entries per fix; live-suite triage note for #48.

- [ ] **Step 1: Write the check (snapshot test)**

Run: `gh issue list --state open --limit 100` and diff against `BUGS.md` table; confirm stale.

- [ ] **Step 2: Run to verify stale**

Expected: count mismatch (23 vs 20), missing #43-#63 rows.

- [ ] **Step 3: Update `BUGS.md` + `CHANGELOG.md`**

Refresh snapshot date/count, move fixed rows to Fixed table with evidence, add tracking rows for accept-edited-workbook + review-report (#51). Do not close #48 until live suite triaged.

- [ ] **Step 4: Run verification suite**

Run: `cd model && npm test; cd ../backend && python -m pytest -q; npx tsc --noEmit` (from model)
Expected: all green; record counts in commit message.

- [ ] **Step 5: Commit**

```bash
git add BUGS.md CHANGELOG.md
git commit -m "docs(register): refresh tracker snapshot, changelog for #43-#63 fixes"
```
