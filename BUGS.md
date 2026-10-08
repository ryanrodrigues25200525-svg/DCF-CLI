# Bugs and open workflow gaps

Last reviewed: **8 October 2026**. This register contains concrete issues found
in the current code review. “Open” means the behavior still needs a code or
product change; it is separate from model-coverage limits listed in
[Model coverage](docs/MODEL_COVERAGE.md).

## GitHub tracker snapshot

Checked on **8 October 2026** with `list_issues --state OPEN` and
`list_pull_requests --state open`: **23 open GitHub issues and 1 open pull
request** (PR [#34](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/pull/34),
draft RFC, unchanged). Issues #1–#8 are closed upstream. The ready-path chain
(#43–#45, #54, #57–#59), fetch gates (#46, #61, #62), peer fallback (#60),
and export sweep (#44, #47, #49, #50, #53, #55, #63) are fixed on branch
`fix/derive-peers-from-filings` (unit suites green; live suite re-run in
progress for #48); the issues stay open until that verification lands and
they are closed in the tracker. Each confirmed bug below has a matching
GitHub issue. This file remains the local summary; the GitHub tracker holds
the work items. [Open the issue
tracker](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues).

## Fixed in this update

| Issue | Status | Evidence |
| --- | --- | --- |
| Filing sync discarded valid issuer reports whenever the accession prefix differed from the issuer CIK. The prefix identifies the submitting account and may belong to a filing agent. | Fixed in `model/src/watch/source-sync.ts` | Live AAPL check failed before the fix on accession `0001140361-26-035325` (issuer CIK `0000320193`) and passed after the fix. Endpoint CIK/ticker checks remain. |
| The live workbook suite embedded a developer-specific LibreOffice path. | Fixed in `model/src/cli.live.test.ts` | The suite now uses the shared `findSoffice()` discovery and a clear `SOFFICE_PATH` setup error. |
| The public-repo staging helper copied ignored workbooks, database files, and runtime-only files, and omitted useful CLI operations docs. | Fixed in `scripts/prepare_public_repo.sh` | The helper now excludes local artifacts and keeps the checked-in Excel template and project docs. |
| Build/update could target the library's `current.xlsx` as its export when `--force` was used, and a missing stored workbook hash could skip the manual-edit conflict gate. | Fixed in `model/src/cli.ts` | Builds reject an export path that aliases `current.xlsx`; a live-built model test corrupts the stored hash and verifies refresh fails closed. |
| The operating DCF fallback could substitute a market-cap-derived pseudo-value and then be marked valuation-supported despite having no forecast rows. | Fixed in `model/src/services/dcf/engine.ts` and `model/src/services/valuation/router.ts` | Fallback now returns no enterprise/equity/per-share value and is unsupported; a live CRM-source redaction check covers the route. |
| Comparable median recomputed downstream instead of shipping the engine's peer set (GE/OXY/NEM/CVX 500s). | Fixed: exports carry `peers_used_for_median` end-to-end (engine → contracts → mapper); backend `ValueError` data errors surface as 422 `DATA_ERROR` with reason on CLI stderr. | [#41](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/41) |
| Derived peer sets could include 20-F/40-F (non-USD) filers; weak zero-industry-match sets entered the median silently. | Fixed in `backend/app/services/finance/peers.py`: non-USD reporters excluded with provenance note; zero-industry-match derived sets flag `fallback_used` and require analyst confirmation. | [#40](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/40) |
| Ticker-equality gates pinned routes to named issuers (MET/PRU life contracts, XOM/PFE model cuts, AGNC mREIT, alt-manager allowlist, S&P 500 template map). | Fixed: routing now keys on filing-derived capability flags (life source contracts, production/product schedules, filed AUM, industry-template sector text); `sp500-template-map.ts` deleted, `detectIndustryTemplate` is sector/industry text only. | [#40](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/40) follow-through |
| Specialist fetch gates were SIC-only, so description/industry-identified biotech/pharma/telecom/energy/asset-manager filers never fetched specialist facts; telecom missed SIC 4812. | Fixed in `backend/app/services/edgar.py`: fetch predicates widened to the classifier's description-OR-SIC predicates (`_is_telecom_filer`/`_is_asset_manager_filer` added). | [#61](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/61), [#62](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/62), [#46](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/46); `test_edgar_fetch_gates.py` 7/7 |
| Hardcoded sector/industry peer tables passed the curated non-fallback guard into the ready median. | Fixed in `backend/app/services/finance/peers.py`: `_is_fallback_peer_source` flags `sector_industry_table` (and `symbol_only_fallback`) as fallback, so the comparable ready guard blocks them. | [#60](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/60); `test_peer_fallback_flag.py` 3/3 |
| Precedent transactions fell back to SOFTWARE comps for any unmapped sector. | Fixed in `model/src/core/data/precedent-transactions.ts`: unmapped sectors return no precedents instead of wrong-sector comps. | [#49](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/49); `precedent-transactions.unit.test.ts` 2/2 |
| Life-insurer ready route had no router case; utility/biotech results wiped forecasts to `[]` while reporting supported. | Fixed in `model/src/services/valuation/router.ts`: life case added; specialist sidecars mapped into canonical forecasts (`specialist-forecasts.ts`); supported-ness gated on non-empty forecasts for utility/biotech/life/telecom. | [#45](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/45), [#58](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/58), [#59](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/59); `router.unit.test.ts` 4/4 |
| Ready utility/biotech router inputs were never passed; ready export had no utility/biotech/life branches; pre-revenue biotech blocked by the operating revenue gate. | Fixed in `model/src/application/run-valuation-job.ts`: sourced specialist builders (`specialist-ready-assumptions.ts`, filed facts only, named analyst-input errors otherwise) feed the router; ready utility/biotech payload builders added (`utility-payload.ts`, `biotech-payload.ts`); life ready export fails closed with a named error; revenue gate exempts `biotech_pipeline_rnpv` and life; rNPV accepts a zero commercial base (pipeline-only value). | [#43](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/43), [#54](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/54), [#57](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/57); job + builder + payload unit tests green |
| Export `asOfDate` used wall-clock when the valuation context date was missing; ready specialist warnings dropped except asset managers; generic 500s opaque; preferred-equity absence needed weaker proof than securities/NCI; biotech false-readiness had no comparable fallback and an MRNA-hardcoded reason; specialist failure diagnostics printed operating-DCF internals. | Fixed: `requireValuationAsOfDate` fails closed (all export sites); `specialistModelWarnings` surfaces every specialist model's warnings; 500s carry triage-safe `kind` + `request_id` and the CLI prints them; preferred-equity absence requires a 10-K/10-K/A with accession/filing date plus no presented row (NCI parity); biotech false-readiness stages a trading-multiple fallback and reasons name the issuer ticker; ready-path failure message is model-aware (`valuationFailureMessage`). Specialist parsers verified 10-K-gated (20-F yields no facts). | [#55](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/55), [#47](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/47), [#53](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/53), [#63](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/63), [#44](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/44), [#50](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/50), [#56](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/56); `test_task5_correctness.py` 4/4, export-guard + backend-client + failure-message unit tests green |

## Confirmed open bugs

Issues #1–#8 below are closed upstream and kept here for history; the live
tracker holds the current work items (#40, #41, #43–#63).

| Priority | Area | Issue and impact | Workaround | GitHub |
| --- | --- | --- | --- | --- |
| P2 | Workbook opening | `dcf model open` can print “Opened” after the operating-system opener starts, even if the desktop session later rejects the file. This can report success on headless Linux. See `model/src/cli.ts`. | Open the workbook from the spreadsheet app or file manager and check that it actually appeared. | [#1](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/1) |
| P2 | Windows workbook support | The workbook helper falls back to `python3` on every platform. A Windows install with `python` but no `python3` shim can fail to inspect or apply workbook edits if the project venv is unavailable. See `model/src/workbook/xlsx.ts`. | Run `npm run install:all` so the project venv contains `openpyxl`. | [#2](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/2) |
| P2 | Proposal value types | CLI `--change` converts simple decimal literals to numbers, but `true`/`false` and scientific-notation values remain text; the CLI cannot clear a cell to blank. Numeric formulas can then receive the wrong cell type. See `coerceScalar()` in `model/src/cli.ts`. | Use simple decimal notation for numeric proposals; edit booleans or blanks directly in Excel. | [#3](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/3) |
| P2 | Cover metadata | The generic DCF cover falls back to “Technology” when both issuer industry and sector are missing, which can display a false classification. The same cover retains generic Deal Overview and empty author/contact fields. See `backend/app/services/excel_export/mappers/cover.py`. | Check the cover against the filed company profile; do not treat the cover label as classification evidence. | [#4](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/4) |
| P2 | Installation on bash/Linux | `npm run install:command` adds `~/.local/bin` to `~/.zprofile` only. A fresh bash/Linux terminal may not find `dcf` on `PATH`. See `scripts/install_cli.sh`. | Add `~/.local/bin` to the startup file used by the current shell. | [#5](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/5) |
| P3 | Windows LibreOffice discovery | `findSoffice()` checks `SOFFICE_PATH` and common install folders on Windows but does not search `PATH`. See `model/src/workbook/xlsx.ts`. | Set `SOFFICE_PATH` to the full `soffice.exe` path. | [#6](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/6) |
| P3 | Minimal Linux LibreOffice discovery | POSIX discovery shells out to `which`. Minimal systems without that utility may miss a valid LibreOffice install that is only on `PATH`. See `model/src/workbook/xlsx.ts`. | Set `SOFFICE_PATH` explicitly. | [#7](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/7) |
| P3 | MCP command help | `dcf mcp --help` and extra arguments are ignored; the server starts and holds the terminal instead of showing usage or rejecting the flags. See `model/src/cli.ts`. | Run `dcf --help` for CLI usage; invoke `dcf mcp` with no arguments. | [#8](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/8) |

## Product and workflow gaps

- **No managed acceptance path for spreadsheet edits.** Tracked in
  [#51](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/51) —
  SHIPPED on this branch: `dcf model accept-edits <ticker> [--note <text>]`
  accepts a manually edited `current.xlsx` as a child revision of the accepted
  hash (pending proposals go stale through the existing gate). Note: this
  versions the edited file; analyst workbook values still do not flow back
  into CLI valuations, so ready utility/biotech/life builders keep failing
  closed with named errors until value ingestion exists.
- **No hosted HTTP MCP endpoint in this repository.** The MCP server is local
  stdio. ChatGPT can inspect an uploaded workbook, or the user can configure a
  supported Secure MCP Tunnel / HTTP deployment. The repository itself does
  not create or host that connection.
- **AI review notes are not persisted as a library artifact.** Tracked in
  [#51](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/51) —
  SHIPPED on this branch: `dcf model review-export <ticker> [--output
  <file.md>] [--force]` writes the exact `model review` report to a markdown
  snapshot file.
- **An update rebuilds the latest data mapped by the selected route.** Several
  specialist routes still use annual actuals and do not incorporate every new
  quarter automatically. Check the route-specific as-of limits in
  [Model coverage](docs/MODEL_COVERAGE.md).
- **Alternative-manager subtype detection is text-only.** BX/KKR carry no
  alternative marker in name/industry/sic and file no parseable alt-manager
  tables, so they resolve `traditional_asset_manager` and stay blocked from
  ready. Fact-based alternative detection (carried-interest/incentive-fee
  table shapes) is future work; no issue filed yet.
- **The live suite needs external services.** The core model suite requires
  SEC identity, network access, current provider data, Python dependencies,
  and LibreOffice. It can be slow and may fail closed when provider data is
  stale or unavailable; that outcome is not proof of a formula defect.
