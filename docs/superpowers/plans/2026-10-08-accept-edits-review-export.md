# Accept-Edits + Review-Export Implementation Plan (#51)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close workflow dead-ends: `dcf model accept-edits <ticker>` accepts a manually edited `current.xlsx` as a new library revision; `dcf model review-export <ticker>` writes the model review report to a markdown file.

**Architecture:** Mirror the staged-publish patterns in `build-staging.ts`/`build-candidate.ts` (`addRevision(parent_hash=old)` → archive → `upsertCompany` → `writeManifestAtomic`); reuse `formatReviewReport()` for file output via a new markdown writer next to `output-writer.ts`. CLI-only; no MCP tools in this plan.

**Tech Stack:** TypeScript (vitest `*.unit.test.ts`), better-sqlite3 ModelLibrary, openpyxl/LibreOffice recalc via existing probes.

**Spec:** Issue #51 body + scope brief from `ses_ee2a4b564ffeqeHmVrKBvDpxBc` (files/functions listed per task). Key conflict gates that must keep working: `MANUAL_EDIT_DETECTED` in `apply-service.ts:113`, `cli.ts:397-399`, MCP `toolProposalCreate:490-502`.

## Global Constraints

- Ticker-free routing only; no new ticker-equality gates.
- Source discipline: accept-edits records the hash chain (parent_hash), never rewrites history; review-export is a snapshot with print date, never a live view.
- TDD for every fix: failing test first, watch it fail, minimal fix, full suite green.
- `npm test` = unit suites only; live suites stay opt-in.

## Review Focus

- Accept-edits on an unmodified library is a no-op with a clear message, not an empty revision.
- Accept-edits while a proposal is pending keeps the proposal's base hash intact (proposal goes stale, never silently rebased).
- Review-export of an input_required model includes the missing-input gaps, not just the passing checks.
- Exported markdown never contains formula internals beyond what `model review` already prints.
- Concurrent accept-edits + proposal apply cannot interleave (second writer fails closed on hash drift).

---

### Task 1: `model accept-edits` service + CLI

**Files:**
- Create: `model/src/review/accept-edits.ts` — `acceptManualEdits(ticker, note, deps): {revisionId, previousHash, newHash}`
- Modify: `model/src/cli.ts:86-133` (usage), `:225`, `:247-283` (parse `--note`), `:1022-1038` (dispatch), new `cmdModelAcceptEdits` mirroring `cmdModelAccept:845-860`
- Test: `model/src/review/accept-edits.unit.test.ts`

**Interfaces:**
- Consumes: `ModelLibrary` (`getCompany`, `addRevision`, `upsertCompany`), `readManifest`/`writeManifestAtomic`/`verifyManifest` (manifest.ts), `readCurrentBytesHash` pattern (apply-service.ts:206-215)
- Produces: `{revisionId: string, previousHash: string, newHash: string}`; manifest + company row point at new revision with `parent_hash=previousHash`

- [ ] **Step 1: Write the failing test**

```typescript
test('accepts a diverged current.xlsx as a child revision', async () => {
  // stage library with accepted revision R1, modify current.xlsx bytes
  const result = await acceptManualEdits('TST', 'analyst forecast tweaks', deps);
  expect(result.previousHash).toBe(r1Hash);
  expect(result.newHash).not.toBe(r1Hash);
  expect(manifest.workbook_hash).toBe(result.newHash);
});

test('clean library is a no-op with a clear message', async () => {
  await expect(acceptManualEdits('TST', 'x', deps)).rejects.toThrow(/no manual edits/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd model && npx vitest run --config vitest.unit.config.ts src/review/accept-edits.unit.test.ts`
Expected: FAIL with "acceptManualEdits not defined"

- [ ] **Step 3: Implement `acceptManualEdits` in `model/src/review/accept-edits.ts`**

Read manifest + current hash; if equal → throw `No manual edits detected for <ticker>; nothing to accept.` If diverged → `addRevision({ticker, workbook_hash: newHash, parent_hash: oldHash, note})`, copy bytes to `revisionPath`, `upsertCompany`, `writeManifestAtomic`. Do NOT touch pending proposals (their base hash now mismatches → they go stale via the existing gate).

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2, then `cd model && npm test`
Expected: PASS, suite green

- [ ] **Step 5: Wire CLI (`usage`, `LIBRARY_COMMANDS`, `parseLibraryArgs`, dispatch, `cmdModelAcceptEdits`)**

Mirror `cmdModelAccept:845-860`; print `Accepted manual edits for <T> as revision <id> (<short-hash> → <short-hash>)`.

- [ ] **Step 6: Commit**

```bash
git add model/src/review/accept-edits.ts model/src/review/accept-edits.unit.test.ts model/src/cli.ts
git commit -m "feat(library): accept manually edited workbook as new revision (#51)"
```

### Task 2: `model review-export` to markdown file

**Files:**
- Create: `model/src/infrastructure/report-writer.ts` — `writeReport(path, markdown): void` (mkdir -p, refuse to overwrite without `--force`)
- Modify: `model/src/cli.ts` (usage, `--output/--force` parse, dispatch, `cmdModelReviewExport` reusing `formatReviewReport()` from `review/review-checks.ts:60-103`)
- Test: `model/src/infrastructure/report-writer.unit.test.ts` + CLI-level test asserting file content equals stdout report plus print-date header

**Interfaces:**
- Consumes: `formatReviewReport()` output, existing review-data builders behind `cmdModelReview:577-632`
- Produces: markdown file at `--output` (default `<models-dir>/companies/<T>/review-<date>.md`)

- [ ] **Step 1: Write the failing test**

```typescript
test('writes the review report to a markdown file', async () => {
  const path = await exportReviewReport('TST', {outputDir: tmp});
  const text = await fs.readFile(path, 'utf8');
  expect(text).toContain('# Model review');
  expect(text).toContain('missing-input');
});

test('refuses to overwrite without --force', async () => {
  await expect(exportReviewReport('TST', {outputDir: tmp, force: false})).rejects.toThrow(/exists/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd model && npx vitest run --config vitest.unit.config.ts src/infrastructure/report-writer.unit.test.ts`
Expected: FAIL with "not defined"

- [ ] **Step 3: Implement `report-writer.ts` + `cmdModelReviewExport`**

Writer: mkdir -p, exists-check unless force, write utf8. Command: build the same report model as `cmdModelReview`, format, write, print `Review report: <path>`. Include missing-input gaps section for input_required models.

- [ ] **Step 4: Run test to verify it passes**

Run: same as Step 2, then `cd model && npm test` + `npx tsc --noEmit`
Expected: PASS, suite + typecheck green

- [ ] **Step 5: Commit**

```bash
git add model/src/infrastructure/report-writer.ts model/src/cli.ts
git commit -m "feat(review): export model review report to markdown file (#51)"
```

### Task 3: Docs + CHANGELOG for #51

**Files:**
- Modify: `BUGS.md` (move accept-edits/review-export gaps to Fixed), `CHANGELOG.md` (Unreleased entries)
- Test: manual — `dcf model accept-edits --help` path prints usage; `git status` clean except intended files

- [ ] **Step 1: Update `BUGS.md` gaps + snapshot line**
- [ ] **Step 2: Update `CHANGELOG.md`**
- [ ] **Step 3: Commit**

```bash
git add BUGS.md CHANGELOG.md
git commit -m "docs(register): accept-edits + review-export shipped (#51)"
```
