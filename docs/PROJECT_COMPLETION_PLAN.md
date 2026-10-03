# DCF CLI Project Completion and Release Plan

> **For agentic workers:** Continue the existing implementation on `feature/ai-reviewed-model-history`; do not rebuild completed work. Use OpenCode Go implementation agents in parallel for independent tasks, with separate file ownership and a final integration review.

**Goal:** Finish DCF CLI as a local-first builder that creates sector-specific, editable Excel DCFs from live data, lets ChatGPT/Codex review and propose changes, compares dated revisions, and publishes a reviewed candidate only after human approval.

**Architecture:** The Python/TypeScript engine owns sourced data, model formulas, workbook recalculation, and deterministic checks. ChatGPT/Codex reads the model and sources, writes the review summary/proposal through MCP, and inspects the separate candidate. `proposal_preview` validates a candidate with an `AI Change Log`; `proposal_apply` promotes only that stored candidate after explicit approval.

**Tech stack:** TypeScript/Node.js CLI and local stdio MCP, Python/EDGAR/OpenBB backend, SQLite model library, native Excel formulas, LibreOffice recalculation, Vitest live suite.

**Implementation plan:** [AI-reviewed model history](superpowers/plans/2026-10-03-ai-reviewed-model-history.md)

## Current status

- Implementation is committed and pushed on `feature/ai-reviewed-model-history` (`43ab374`, documentation/status follow-up `61a7d28`).
- Draft PR [#17](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/pull/17) closes Issues #1–#16 and references Issues #18 and #20. Issue #18 tracks the macOS LibreOffice headless-startup blocker; Issue #20 tracks the missing mandatory AI review gate for fresh builds/updates. Issue #19 is closed as a duplicate of #18.
- Current package version remains `2.0.0`. No release tag was created.
- Typecheck, secret scan, diff check, targeted fail-fast/duplicate-path tests, and the live AAPL filing-agent check passed.
- `npm run test:model` is blocked: 9 platform tests passed and 1 failed because LibreOffice hangs on `--headless --version`; the CLI live suite aborts at module import. The full live DCF suite did not run.
- No dated AAPL/JPM/XOM/DUK example workbooks have been generated. The PR is draft and must not be merged as complete.
- The current candidate workflow applies AI proposals to an accepted model, but initial `dcf build` and earnings `dcf model update` can still publish before AI/human review. Issue #20 is a required product phase, not a completed feature.

## Project rules

- Use live EDGAR/OpenBB company data for model and route tests. Do not replace provider/model tests with fixture-only substitutes.
- Missing required data stays blank and visibly input-required; never invent a valuation.
- Keep native Excel formulas editable and recalculate the final workbook after every OpenPyXL write that can clear cached formula results.
- AI proposals must be source-backed. Preview and validate a separate candidate; never overwrite the accepted workbook until a human explicitly approves promotion.
- The valuation engine does not call an LLM. ChatGPT/Codex performs the review through CLI/MCP tools and records the AI summary/change log.
- Do not store API credentials, identity strings, user model libraries, or user workbooks in the repository.
- Do not merge PR #17, close issues, or publish a release without human approval.

## Phase 1 — Repair the live spreadsheet runtime

**Files/tools:** macOS LibreOffice installation, `model/src/workbook/xlsx.ts`, `model/src/platform.live.test.ts`, Issue #18.

- [ ] Diagnose why the signed Homebrew LibreOffice 26.8.0 app exists but `soffice --headless --version` hangs. Check startup/launch state and the unique `UserInstallation` profile used by recalculation. Do not weaken `findSoffice()` to accept a nonworking binary.
- [ ] If this host cannot run LibreOffice, select a supported runner that has LibreOffice and live SEC access; document the runner and preserve the live-data requirement.
- [ ] Verify `soffice --headless --version` returns exit 0 in under 5 seconds.
- [ ] Recalculate a disposable workbook with the same `recalculateWorkbook` path used by the CLI; confirm the output file is fresh, formulas remain native, and cached values/errors are inspectable.

**Exit:** Issue #18 is reproducibly resolved or a supported live-test runner is documented.

## Phase 2 — Run the complete live verification suite

**Files/commands:** `model/src/cli.live.test.ts`, `model/src/platform.live.test.ts`, `model/scripts/check_filing_agent_accession.ts`.

- [ ] Run `npm run typecheck` and `npm run security:scan`.
- [ ] Run `npm run test:model` to completion. It must exit 0; report the test count and skipped platform-specific cases.
- [ ] Confirm the live AAPL filing-agent accession check passes in the full run.
- [ ] Verify the live model-route cases across operating companies, banks, energy, and input-required regulated utilities. Check sourced actuals, route/readiness, unit/period mapping, native formulas, cached errors, valuation gates, and formulas responding to editable assumptions.
- [ ] Re-run candidate lifecycle cases on a live AAPL workbook: value/formula proposal, zero-edit AI review, change-log contents, preview without accepted-file changes, stale/corrupt candidate refusal, approval promotion, rejection, MCP parity, cached formula values, and revision comparison.
- [ ] Run the available Windows checks on a Windows host/CI runner, or list them explicitly as unverified. Do not infer Windows correctness from macOS results.

**Exit:** The live test command exits 0 and every failure/skipped case has an explained disposition.

## Phase 3 — Generate dated live example workbooks

**Files:** `examples/*.xlsx`, `examples/README.md`, `.gitignore`.

- [ ] Use an isolated temporary model-library root and the production CLI to build live examples for AAPL, JPM, XOM, and DUK. Name each export `YYYY-MM-DD_TICKER_DCF.xlsx` using the actual UTC build date.
- [ ] Keep DUK visibly input-required if required data is missing; it must not show an invented valuation.
- [ ] Record each workbook’s build date, ticker, route, readiness, source accession, mapped period, currency/unit scale, and relevant route limitations in `examples/README.md`.
- [ ] Whitelist only `examples/*.xlsx` in `.gitignore`. Confirm no SQLite database, manifest, source snapshot, local identity string, or user workbook is staged.
- [ ] Recalculate and inspect all four examples. Check formula count, cached errors, source references, missing-input gates, route, period, and formula editability. Test an editable assumption on a disposable copy and confirm the relevant output recalculates.

**Exit:** Four dated, live-generated workbooks are in the repository with accurate source/period/readiness notes and no private library artifacts.

## Phase 4 — Finalize AI review and revision workflow

**Files:** `README.md`, `docs/MODEL_LIBRARY.md`, `.superpowers/skills/dcf-model-review/SKILL.md`, `model/src/cli.ts`, `model/src/mcp/server.ts`.

- [ ] Confirm every build/update review workflow inspects the current workbook, compares its prior revision, reads stored source lineage, and retrieves primary filing narrative when available. State when narrative is unavailable.
- [ ] Confirm MCP `proposal_preview` returns validation details and prior/proposed cell content so the AI/human can review the candidate.
- [ ] Confirm `proposal_apply` requires the reviewed candidate and explicit approval; rejection/staleness/errors leave `current.xlsx`, manifest, and revision rows unchanged.
- [ ] Run one end-to-end live ChatGPT/Codex workflow: build/update → inspect/compare → AI summary/verification and sourced proposal → preview/change log → human approval → new dated revision → compare against prior.

**Exit:** The documented CLI and MCP flow matches the tested behavior and the accepted model changes only after approval.

## Phase 5 — Require AI review and human approval for every build/update

**Issue:** [#20](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/20)

This is the central product workflow. The valuation engine builds the model deterministically; ChatGPT/Codex verifies freshness, sources, formulas, and changes; a human reviews the candidate; only then does the library accept it. The LLM remains outside Python/TypeScript. The new gate must work for initial builds and earnings refreshes, not only proposals against an already accepted workbook.

- [ ] Audit `cmdBuild`, `persistWorkbookRevision`, library manifests/revisions, proposal creation/preview/application, and MCP tools. Document which writes currently replace `current.xlsx` before an AI review.
- [ ] Add a staged/pending build candidate for initial build and update. For an update, the prior accepted `current.xlsx`, manifest, and revision remain unchanged. For an initial build, do not label the candidate accepted before review. Persist ticker/date, route/readiness, source accessions, mapped period, and base-revision hash when one exists.
- [ ] Expose the pending candidate through the shared CLI/MCP services so the agent can read cells/formulas, deterministic validation, source snapshot, and prior comparison without promoting it.
- [ ] Require an AI review result containing: freshness verdict (latest detected filing vs facts actually mapped), source/period/unit checks, formula/tie-out findings, concise summary, prior-model commentary when one exists, and source-backed cell/formula edits or an explicit no-change result.
- [ ] Reuse the candidate/AI Change Log path for proposed edits. Make human approval the only promotion path. Rejection, stale sources, missing periods, or validation failures must preserve the prior accepted workbook and its revision metadata.
- [ ] Add a live AAPL initial-build workflow and a second live refresh workflow using an actual later SEC filing when available. Assert the new dated revision records the mapped accession/period and compares against the previous revision; if a route detects a newer filing but does not map it, the AI summary must say the model is not updated with that period.
- [ ] Add a live missing-input case (DUK) proving the AI review does not invent value, plus formula/value edit, review-only, rejection, stale-candidate, and approved-promotion cases. Keep provider data live; no mock LLM or fixture provider.
- [ ] Update README, MCP tool descriptions, and the review skill with the exact build → AI review/compare → candidate → human approval workflow. State that standalone CLI build output is not AI-verified unless the agent review ran.

**Exit:** Both first-build and earnings-update workflows produce a pending candidate, AI summary/change log, and prior-revision commentary; no candidate becomes accepted without human approval. The old revision remains queryable and the comparison names what changed and why.

## Phase 6 — GitHub review, merge, and versioned release

- [ ] Update PR #17 with the final live test counts, example workbook links, and any remaining platform limitations. Keep it draft until Phases 1–5 pass.
- [ ] Have a human review the final diff and PR. Mark it ready only after the release gates pass; merge only after explicit approval.
- [ ] Confirm Issues #1–#16 close through PR #17 after merge. Keep Issue #18 open until the LibreOffice blocker is resolved and the live suite passes. Keep Issue #20 open until the mandatory AI review gate in Phase 5 ships and passes its live end-to-end workflow.
- [ ] After merge, bump the root package, model package, and lockfile versions together. The current additive scope suggests `2.1.0`; use a major bump if the final changes break the documented CLI/MCP contract.
- [ ] Move `CHANGELOG.md` Unreleased notes to the release entry, create tag `v2.1.0` (or the approved version), and publish the GitHub Release only after the merge and full acceptance checks.
- [ ] Fast-forward the normal Documents checkout (`/Users/ryanrodrigues/Documents/DCF CLI`) to the merged `main` so the project’s usual local folder has the release state.

**Exit:** Merged reviewed PR, resolved issues, clean local `main`, matching package/lockfile version, and a GitHub release tag.

## Codex handoff prompt

> Continue DCF CLI from draft PR #17 and `docs/PROJECT_COMPLETION_PLAN.md`. Do not redo the implementation already in the branch. First diagnose the installed macOS LibreOffice headless hang or select a supported live-test runner; do not weaken engine validation. Then complete Phases 2–5 using live company data, enforce AI review/human approval for initial builds and earnings updates, generate/inspect the dated examples, update PR #17 and Issues #1–#20, and report exact test results. Keep the PR draft until the acceptance gates pass. After human approval to merge, synchronize the Documents checkout and complete the 2.1.0 version/tag/release steps. Do not merge or publish a release without explicit approval.
