# Bugs and open workflow gaps

Last reviewed: **3 October 2026**. This register contains concrete issues found
in the current code review. “Open” means the behavior still needs a code or
product change; it is separate from model-coverage limits listed in
[Model coverage](docs/MODEL_COVERAGE.md).

## Fixed in this update

| Issue | Status | Evidence |
| --- | --- | --- |
| Filing sync discarded valid issuer reports whenever the accession prefix differed from the issuer CIK. The prefix identifies the submitting account and may belong to a filing agent. | Fixed in `model/src/watch/source-sync.ts` | Live AAPL check failed before the fix on accession `0001140361-26-035325` (issuer CIK `0000320193`) and passed after the fix. Endpoint CIK/ticker checks remain. |
| The live workbook suite embedded a developer-specific LibreOffice path. | Fixed in `model/src/cli.live.test.ts` | The suite now uses the shared `findSoffice()` discovery and a clear `SOFFICE_PATH` setup error. |
| The public-repo staging helper copied ignored workbooks, database files, and runtime-only files, and omitted useful CLI operations docs. | Fixed in `scripts/prepare_public_repo.sh` | The helper now excludes local artifacts and keeps the checked-in Excel template and project docs. |
| Build/update could target the library's `current.xlsx` as its export when `--force` was used, and a missing stored workbook hash could skip the manual-edit conflict gate. | Fixed in `model/src/cli.ts` | Builds reject an export path that aliases `current.xlsx`; a live-built model test corrupts the stored hash and verifies refresh fails closed. |
| The operating DCF fallback could substitute a market-cap-derived pseudo-value and then be marked valuation-supported despite having no forecast rows. | Fixed in `model/src/services/dcf/engine.ts` and `model/src/services/valuation/router.ts` | Fallback now returns no enterprise/equity/per-share value and is unsupported; a live CRM-source redaction check covers the route. |

## Confirmed open bugs

| Priority | Area | Issue and impact | Workaround |
| --- | --- | --- | --- |
| P2 | Workbook opening | `dcf model open` can print “Opened” after the operating-system opener starts, even if the desktop session later rejects the file. This can report success on headless Linux. See `model/src/cli.ts`. | Open the workbook from the spreadsheet app or file manager and check that it actually appeared. |
| P2 | Windows workbook support | The workbook helper falls back to `python3` on every platform. A Windows install with `python` but no `python3` shim can fail to inspect or apply workbook edits if the project venv is unavailable. See `model/src/workbook/xlsx.ts`. | Run `npm run install:all` so the project venv contains `openpyxl`. |
| P2 | Proposal value types | CLI `--change` converts simple decimal literals to numbers, but `true`/`false` and scientific-notation values remain text; the CLI cannot clear a cell to blank. Numeric formulas can then receive the wrong cell type. See `coerceScalar()` in `model/src/cli.ts`. | Use simple decimal notation for numeric proposals; edit booleans or blanks directly in Excel. |
| P2 | Cover metadata | The generic DCF cover falls back to “Technology” when both issuer industry and sector are missing, which can display a false classification. The same cover retains generic Deal Overview and empty author/contact fields. See `backend/app/services/excel_export/mappers/cover.py`. | Check the cover against the filed company profile; do not treat the cover label as classification evidence. |
| P2 | Installation on bash/Linux | `npm run install:command` adds `~/.local/bin` to `~/.zprofile` only. A fresh bash/Linux terminal may not find `dcf` on `PATH`. See `scripts/install_cli.sh`. | Add `~/.local/bin` to the startup file used by the current shell. |
| P3 | Windows LibreOffice discovery | `findSoffice()` checks `SOFFICE_PATH` and common install folders on Windows but does not search `PATH`. See `model/src/workbook/xlsx.ts`. | Set `SOFFICE_PATH` to the full `soffice.exe` path. |
| P3 | Minimal Linux LibreOffice discovery | POSIX discovery shells out to `which`. Minimal systems without that utility may miss a valid LibreOffice install that is only on `PATH`. See `model/src/workbook/xlsx.ts`. | Set `SOFFICE_PATH` explicitly. |
| P3 | MCP command help | `dcf mcp --help` and extra arguments are ignored; the server starts and holds the terminal instead of showing usage or rejecting the flags. See `model/src/cli.ts`. | Run `dcf --help` for CLI usage; invoke `dcf mcp` with no arguments. |

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
- **AI review notes are not persisted as a library artifact.** ChatGPT's
  free-form findings stay in the conversation; structured, source-backed cell
  changes can be retained as proposals. There is no review-report or comments
  export yet.
- **An update rebuilds the latest data mapped by the selected route.** Several
  specialist routes still use annual actuals and do not incorporate every new
  quarter automatically. Check the route-specific as-of limits in
  [Model coverage](docs/MODEL_COVERAGE.md).
- **The live suite needs external services.** The core model suite requires
  SEC identity, network access, current provider data, Python dependencies,
  and LibreOffice. It can be slow and may fail closed when provider data is
  stale or unavailable; that outcome is not proof of a formula defect.
