# DCF CLI Project Completion and Release Plan

> **For agentic workers:** Continue the existing implementation on `feature/ai-reviewed-model-history`; do not rebuild completed work. Use OpenCode Go implementation agents in parallel for independent tasks, with separate file ownership and a final integration review.

**Goal:** Finish DCF CLI as a local-first builder that creates sector-specific, editable Excel DCFs from live data, lets ChatGPT/Codex review and propose changes, compares dated revisions, and publishes a reviewed candidate only after human approval.

**Architecture:** The Python/TypeScript engine owns sourced data, model formulas, workbook recalculation, and deterministic checks. ChatGPT/Codex reads the model and sources, writes the review summary/proposal through MCP, and inspects the separate candidate. `proposal_preview` validates a candidate with an `AI Change Log`; `proposal_apply` promotes only that stored candidate after explicit approval.

**Tech stack:** TypeScript/Node.js CLI and local stdio MCP, Python/EDGAR/OpenBB backend, SQLite model library, native Excel formulas, LibreOffice recalculation, Vitest live suite.

**Implementation plan:** [AI-reviewed model history](superpowers/plans/2026-10-03-ai-reviewed-model-history.md)

## Current status

- Implementation is committed and pushed on `feature/ai-reviewed-model-history` (`43ab374`, documentation/status follow-up `61a7d28`).
- Draft PR [#17](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/pull/17) links Issues #1–#16. Issue #18 tracks the current macOS LibreOffice headless-startup blocker.
- Current package version remains `2.0.0`. No release tag was created.
- Typecheck, secret scan, diff check, targeted fail-fast/duplicate-path tests, and the live AAPL filing-agent check passed.
- `npm run test:model` is blocked: 9 platform tests passed and 1 failed because LibreOffice hangs on `--headless --version`; the CLI live suite aborts at module import. The full live DCF suite did not run.
- No dated AAPL/JPM/XOM/DUK example workbooks have been generated. The PR is draft and must not be merged as complete.

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

## Phase 5 — GitHub review, merge, and versioned release

- [ ] Update PR #17 with the final live test counts, example workbook links, and any remaining platform limitations. Keep it draft until Phases 1–4 pass.
- [ ] Have a human review the final diff and PR. Mark it ready only after the release gates pass; merge only after explicit approval.
- [ ] Confirm Issues #1–#16 close through PR #17 after merge. Keep Issue #18 open until the LibreOffice blocker is resolved and the live suite passes.
- [ ] After merge, bump the root package, model package, and lockfile versions together. The current additive scope suggests `2.1.0`; use a major bump if the final changes break the documented CLI/MCP contract.
- [ ] Move `CHANGELOG.md` Unreleased notes to the release entry, create tag `v2.1.0` (or the approved version), and publish the GitHub Release only after the merge and full acceptance checks.
- [ ] Fast-forward the normal Documents checkout (`/Users/ryanrodrigues/Documents/DCF CLI`) to the merged `main` so the project’s usual local folder has the release state.

**Exit:** Merged reviewed PR, resolved issues, clean local `main`, matching package/lockfile version, and a GitHub release tag.

## Codex handoff prompt

> Continue DCF CLI from draft PR #17 and `docs/PROJECT_COMPLETION_PLAN.md`. Do not redo the implementation already in the branch. First diagnose the installed macOS LibreOffice headless hang or select a supported live-test runner; do not weaken engine validation. Then complete Phases 2–4 using live company data, generate/inspect the dated examples, update PR #17 and Issues #1–#18, and report exact test results. Keep the PR draft until the acceptance gates pass. After human approval to merge, synchronize the Documents checkout and complete the 2.1.0 version/tag/release steps. Do not merge or publish a release without explicit approval.
