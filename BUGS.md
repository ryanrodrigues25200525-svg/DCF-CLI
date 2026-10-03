# Bugs and open workflow gaps

Last reviewed: **3 October 2026**. This register contains concrete issues found
in the current code review. “Open” means the behavior still needs a code or
product change; it is separate from model-coverage limits listed in
[Model coverage](docs/MODEL_COVERAGE.md).

## GitHub tracker snapshot

Checked on **3 October 2026** with `gh issue list --state open` and
`gh pr list --state open`: **17 open GitHub issues and 1 open draft pull
request** ([#17](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/pull/17)).
Issues #1–#8 are the earlier CLI/platform bugs; #9–#16 are the new
review findings from the AI-reviewed model-history work. Issue #18 tracks the
macOS LibreOffice headless-startup blocker. Issue #19 was closed as a duplicate
of #18. Issues #1–#16 have fixes committed and pushed on the feature branch
`feature/ai-reviewed-model-history` (`43ab374`, with follow-up docs commit
`61a7d28`); none is merged or closed. Draft PR #17 closes #1–#16 and references
#18, but does not close the runtime blocker. `main` still carries the old
behavior until the branch lands.
Typecheck, the security scan, `git diff --check`, the targeted
hung-LibreOffice and duplicate-candidate platform regressions, and the live AAPL
filing-agent accession check pass on the pushed branch. The full live suite is
still blocked: LibreOffice is installed but its headless startup hangs, and the
CLI live suite aborts at module import, so its tests did not run. Dated example
workbooks, the examples whitelist, the complete diff review, and Windows-only
behavior are still unverified. "Fixed" below means the code change is present on
the pushed branch, not that it has been fully live-verified, merged, or closed.

## Verification blocker #18

Homebrew LibreOffice 26.8.0 is present at `/Applications/LibreOffice.app`, but
`soffice --headless --version` does not return. The bounded DCF CLI probe now
fails fast. Until this runtime is repaired or a supported live-test runner is
used, the CLI live suite cannot load, the full model suite cannot pass, and the
dated example workbooks cannot be generated and inspected. Track the resolution
in [GitHub issue #18](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/18).
This file remains the local summary; the GitHub tracker holds the work items.
[Open the issue tracker](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues).

## Fixed in this update

These fixes are committed and pushed on `feature/ai-reviewed-model-history`
(commit `43ab374`, draft PR
[#17](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/pull/17)); the related
public items are not closed and the draft PR is not merged. The targeted platform
regressions, typecheck, security scan, and live AAPL filing-agent accession check
pass, but the full live suite has not re-confirmed them for the current review
(LibreOffice is installed but its headless startup hangs, and the CLI live suite
aborts at module import).

| Issue | Status | Evidence |
| --- | --- | --- |
| Filing sync discarded valid issuer reports whenever the accession prefix differed from the issuer CIK. The prefix identifies the submitting account and may belong to a filing agent. | Fixed in `model/src/watch/source-sync.ts` | Live AAPL check failed before the fix on accession `0001140361-26-035325` (issuer CIK `0000320193`) and passed after the fix. Endpoint CIK/ticker checks remain. |
| The live workbook suite embedded a developer-specific LibreOffice path. | Fixed in `model/src/cli.live.test.ts` | The suite now uses the shared `findSoffice()` discovery and a clear `SOFFICE_PATH` setup error. |
| The public-repo staging helper copied ignored workbooks, database files, and runtime-only files, and omitted useful CLI operations docs. | Fixed in `scripts/prepare_public_repo.sh` | The helper now excludes local artifacts and keeps the checked-in Excel template and project docs. |
| Build/update could target the library's `current.xlsx` as its export when `--force` was used, and a missing stored workbook hash could skip the manual-edit conflict gate. | Fixed in `model/src/cli.ts` | Builds reject an export path that aliases `current.xlsx`; a live-built model test corrupts the stored hash and verifies refresh fails closed. |
| The operating DCF fallback could substitute a market-cap-derived pseudo-value and then be marked valuation-supported despite having no forecast rows. | Fixed in `model/src/services/dcf/engine.ts` and `model/src/services/valuation/router.ts` | Fallback now returns no enterprise/equity/per-share value and is unsupported; a live CRM-source redaction check covers the route. |

## Tracked issues #1–#8: fix committed and pushed, still open on GitHub

Each row below has a code fix committed and pushed on
`feature/ai-reviewed-model-history` (commit `43ab374`) with a CLI regression
added. The targeted hung-LibreOffice and duplicate-candidate platform regressions
pass, but the full live suite has not run and the CLI live suite aborts at module
import, so per-case live verification is pending. The GitHub issue stays open
until the draft PR (#17) merges; do not report it as closed or fully verified
before then.

| Priority | Area | Issue and fix on branch | Evidence | GitHub |
| --- | --- | --- | --- | --- |
| P2 | Workbook opening | `dcf model open` no longer claims success when the desktop opener fails: success requires a clean exit, a non-exiting opener fails closed, and headless Linux reports the path instead of spawning. | `model/src/cli.ts` | [#1](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/1) |
| P2 | Windows workbook support | Interpreter discovery now tries `python`, `python3`, and `py` on Windows (and `python3`, `python` on POSIX) so a Windows install without a `python3` shim can still inspect or apply edits. | `model/src/workbook/xlsx.ts` | [#2](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/2) |
| P2 | Proposal value types | CLI `--change` now types booleans (`true`/`false`) and scientific notation, and `__BLANK__` clears a cell to a true blank; numeric formulas no longer receive the wrong cell type. | `coerceScalar()` in `model/src/cli.ts` | [#3](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/3) |
| P2 | Cover metadata | The generic DCF cover now labels a missing industry and sector as “Not disclosed” instead of a false “Technology” classification, and clears author/contact fields when absent. | `backend/app/services/excel_export/mappers/cover.py` | [#4](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/4) |
| P2 | Installation on bash/Linux | `npm run install:command` writes a runtime-idempotent `PATH` line to the shell-appropriate startup files (`.zprofile`/`.zshrc`, `.bash_profile`/`.bashrc`, or `.profile`), so fresh bash/Linux terminals find `dcf`. | `scripts/install_cli.sh` | [#5](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/5) |
| P3 | Windows LibreOffice discovery | `findSoffice()` now searches `PATH` on every platform, including Windows, before the common install folders. | `model/src/workbook/xlsx.ts` | [#6](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/6) |
| P3 | Minimal Linux LibreOffice discovery | POSIX discovery walks `PATH` directly instead of shelling out to `which`, so minimal systems still find LibreOffice. | `model/src/workbook/xlsx.ts` | [#7](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/7) |
| P3 | MCP command help | `dcf mcp` now takes no arguments: exactly `--help`/`-h` prints usage, and any other extra argument is rejected before the stdio server starts, so a typo cannot hold the terminal. | `model/src/cli.ts` | [#8](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/8) |

## Review findings #9–#16: fix committed and pushed, still open on GitHub

Each row below is a new review finding with a fix committed and pushed on
`feature/ai-reviewed-model-history` (commit `43ab374`, draft PR #17). The
targeted platform regressions pass, but the full live suite has not run and the
CLI live suite aborts at module import, so live verification is pending. The
GitHub issue stays open until the draft PR merges; do not report any as closed or
fully verified before then.

| Priority | Area | Issue and fix on pushed branch | GitHub |
| --- | --- | --- | --- |
| P1 | Formula caches | Writing the final `AI Change Log` summary can clear cached formula results, so the last inspection may report no cached errors even though caches are missing. Recalculate after the final log write and validate that final workbook before preview returns or apply promotes it; keep the log text formula-safe. | [#9](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/9) |
| P2 | Revision comparison | Every AI-reviewed revision adds an `AI Change Log` sheet; its narrative cells can overwhelm the real DCF changes. Exclude the reserved audit sheet from financial cell counts and sheet-added/removed deltas. | [#10](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/10) |
| P2 | Proposal validation | A string `proposedValue` beginning with `=` is ambiguous and can bypass the formula/type contract. Formula edits must use `proposedFormula`; reject `=`-prefixed `proposedValue` consistently across CLI, MCP, and persisted proposals. | [#11](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/11) |
| P1 | Revision archives | Comparison must verify archived workbook bytes against the recorded revision SHA-256. A missing archive falls back to `current.xlsx` only when its hash exactly matches that revision; never backfill an old revision from a diverged current workbook. | [#12](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/12) |
| P2 | Filing freshness | A revision can carry latest detected filing metadata while its mapped fact accession is missing. Report the latest filing and state that mapped-fact freshness is unconfirmed instead of claiming no filing metadata was captured. | [#13](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/13) |
| P2 | Approval path | Approval must promote the candidate already created and reviewed by `proposal_preview`; apply must not build and publish inline. The promoted revision retains filing/route/readiness context, records the proposal source, and cleans rollback artifacts on failure. | [#14](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/14) |
| P2 | MCP errors | `proposal_apply` should distinguish approval-required, preview-required, stale-base, manual-edit, invalid-source, and engine-unavailable failures instead of collapsing them into `APPLY_FAILED`, with categories consistent between `proposal_preview` and `proposal_apply`. | [#15](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/15) |
| P3 | Legacy libraries | A legacy library can have a `companies` table but no `revisions` table. Read-only MCP `revisions_list` should return an empty paged history without creating or migrating tables, rather than returning `LIBRARY_UNAVAILABLE`. | [#16](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/16) |

No confirmed code bug is unfixed on the pushed branch. The sixteen GitHub issues
above remain open until the draft PR (#17) merges and the public tracker is
updated; neither has happened.

## Product and workflow gaps

- **No managed acceptance path for spreadsheet edits.** Editing
  `companies/<TICKER>/current.xlsx` changes its hash; proposal application
  refuses to proceed until that conflict is resolved. There is no command yet
  to accept a manually edited workbook as a new library revision. For now,
  keep analyst experiments in a separate workbook copy and preserve the
  library copy for proposal/revision workflows.
- **No hosted HTTP MCP endpoint in this repository.** The MCP server is local
  stdio. ChatGPT can inspect an uploaded workbook, or the user can configure a
  supported Secure MCP Tunnel / HTTP deployment. The repository itself does
  not create or host that connection.
- **Free-form AI review notes are not exported.** Structured review content is
  retained: a proposal stores the AI summary and verification, and a previewed
  candidate carries them plus cell-level changes and the validation result in its
  `AI Change Log` sheet. ChatGPT's free-form conversation text still has no
  review-report or comments export.
- **An update rebuilds the latest data mapped by the selected route.** Several
  specialist routes still use annual actuals and do not incorporate every new
  quarter automatically. `dcf model compare` states when the latest detected
  filing was not mapped into the workbook. Check the route-specific as-of limits
  in [Model coverage](docs/MODEL_COVERAGE.md).
- **The live suite needs external services.** The core model suite requires
  SEC identity, network access, current provider data, Python dependencies,
  and LibreOffice. It can be slow and may fail closed when provider data is
  stale or unavailable; that outcome is not proof of a formula defect. The
  full live suite has not run for the pushed branch changes. LibreOffice
  is installed but headless startup hangs, and the CLI live suite aborts at
  module import, so live verification is pending; no complete live verification
  is claimed and no dated example workbooks are generated.
