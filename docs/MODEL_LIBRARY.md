# Model Library

Local-first persistent library for DCF workbooks. Human approval precedes
any workbook change. The TypeScript valuation engine is the single
calculation core; Python (`backend/.venv`, openpyxl) owns SEC retrieval,
canonical financials, eligibility, workbook export and inspection;
LibreOffice `soffice` recalculates workbooks after cell edits.
Discovery order: `SOFFICE_PATH` env, then `PATH` (`which soffice`), then
standard locations (`/opt/homebrew/bin/soffice`,
`/Applications/LibreOffice.app/Contents/MacOS/soffice`, `/usr/bin/soffice`,
`/usr/local/bin/soffice`; plus `C:\Program Files\LibreOffice\...` on
Windows). Candidates are accepted only if `soffice --headless --version`
executes. No host-specific binary path is embedded in product code.

Requires Node.js >= 22.5.0 (`node:sqlite`; declared in `engines` of
`package.json` and `model/package.json`, enforced at CLI startup).

## Library root

```bash
export DCF_MODELS_DIR="$HOME/DCF-Models"
dcf config models-dir             # show resolved root
dcf config models-dir --set <dir> # validate, create, persist
```

Resolution order: `--models-dir <dir>` flag, then `DCF_MODELS_DIR` env,
then `~/.config/dcf-builder/config.json` (`modelsDir`), then `~/DCF-Models`.

## Layout

Each company lives under `companies/<TICKER>/`:

- `current.xlsx` — the accepted workbook copy.
- `manifest.json` — ticker, route, currency, unitScale, accession,
  filedDate, workbookHash, builtAt, readiness, revisionId; written atomically
  (temp file + rename) whenever the accepted revision changes.
- `revisions/<revId>.xlsx` — immutable history copies (parent hash + note).
- `library.db` — SQLite index: companies, revisions, proposals, snapshots, watch.
  Snapshots store the normalized source snapshot: canonical financials, native
  route facts, provenance, quality, market context, peers, plus a
  `_latestFiling` block (accession/date/form/report date/primary document from
  the SEC filings list) and a bounded `_recentFilings` list. Per-fact sources
  keep each fact's own true filing — annual facts are never relabeled as
  coming from a newer filing.

## CLI (`bin/dcf.mjs`)

| Command | Effect (read-only unless noted) |
| --- | --- |
| `dcf build <ticker> [--output F] [--force]` | Builds via the shared TS engine, then recalculates and inspects the staged copy (sheets/formulas required, zero cached formula errors) before publishing. Saves `current.xlsx`, an immutable revision, the manifest, and a normalized snapshot. By default it also exports `YYYY-MM-DD_<TICKER>_DCF.xlsx` under `~/Downloads` (UTC build date; repeated exports get a numeric suffix); `--output` selects a different export path. Refuses on a diverged copy unless `--force`, which archives the diverged bytes first. |
| `dcf model update <ticker> [--output F] [--force]` | Explicitly reruns the same validated build using the latest data mapped by that route; it creates a new library revision and dated export. It can also create the initial model if none exists. |
| `dcf model export <ticker> [--output F] [--force]` | Copies the accepted `current.xlsx` to a new dated export without fetching data or rebuilding. It refuses if the file hash differs from the accepted manifest. |
| `dcf models list [--json]` | Lists library tickers with route/readiness |
| `dcf model inspect <ticker> [--json]` | Manifest file + DB rows + hash verification |
| `dcf model open <ticker>` | Opens the workbook in the host app; library copy unchanged |
| `dcf model review <ticker>` | Static checks plus real xlsx inspection: sheet list, formula count, cached formula errors, Input Required status, Data Review rows (backend-venv openpyxl) |
| `dcf model propose-update <ticker> --change 'spec'` | Records a sourced proposal (status `proposed`); reads each targeted cell's current literal/formula into `priorValue`/`priorFormula` at creation and shows them in the preview; workbook untouched |
| `dcf model apply <id> --approve [--by name]` | Applies an approved proposal (see below) |
| `dcf model reject <id> [--reason text]` | Status-only rejection; workbook unchanged |
| `dcf filings sync <ticker>` | Fetches unified model data + the SEC filings list (`GET /api/company/{ticker}/filings`, EdgarTools source); selects the latest identity-validated report filing (endpoint CIK and ticker must match the profile/request; accession prefixes are submitting-account CIKs and may belong to filing agents; Form 3/4/5/144 never model filings); stores snapshot, flags update-ready; never edits workbooks |
| `dcf watch status` | Read-only table (enabled, update-ready, accession) |
| `dcf watch check [ticker]` | One-shot refresh of one or all enabled tickers; snapshots only |
| `dcf watch run [--interval s] [ticker]` | Polls enabled tickers through the live backend source path on the interval; Ctrl+C stops; never writes workbook files |
| `dcf watch pause <ticker>` / `dcf watch resume <ticker>` | Pause/resume flagging without losing state |
| `dcf config models-dir [--set <dir>]` | Show or persist the library root |
| `dcf mcp` | Start the local stdio MCP server |

The legacy `dcfbuild [<ticker>]` form (no library subcommand) keeps the
standalone-file behavior and never touches the library. Its default Downloads
filename is also date-and-ticker stamped; an explicit `--output` is honored.
The filename date is the UTC build/export date, not the SEC filing period.

Change spec: `sheet|cell|proposed|rationale|source[|accession]` (accession
defaults to the latest snapshot, but must be the accepted manifest accession
or a stored snapshot accession — unknown filings are refused). A leading `=`
in `proposed` is an explicit formula edit; plain numeric literals are stored
as numbers. Creation reads each targeted cell's current literal/formula into
`priorValue`/`priorFormula` and shows them in the preview. Every change
needs a filed `source` + SEC `accession`; unsourced values are rejected.

## Apply (`model/src/review/apply-service.ts`)

`applyApprovedProposal` is shared by the CLI and MCP. It rechecks the
manifest + on-disk hash + proposal base immediately before applying
(`MANUAL_EDIT_DETECTED`/stale aborts; nothing changed); copies
`current.xlsx`; applies every validated cell edit via openpyxl (recording
prior value/formula); recalculates with LibreOffice `soffice`; aborts on any
NEW cached formula error vs baseline or lost sheets/formulas. Publication is
staged, not claimed atomic: new bytes are staged next to `current.xlsx`,
rollback copies/state (prior workbook bytes, manifest text, company row,
proposal status) are retained, then the revision row, archive copy,
same-directory rename into `current.xlsx`, `manifest.json`, index, and
proposal `applied` + audit are committed in order. Any publication failure
triggers rollback restoring `current.xlsx`, `manifest.json`, and the SQLite
company/revision/proposal rows. New builds likewise publish `current.xlsx`
via same-directory temp file + rename after validation.

## MCP tools (local stdio)

Start with `npm --prefix model run dcf-mcp` (or `dcf mcp`).

| Tool | Access |
| --- | --- |
| `models_list` | Read-only company list |
| `model_inspect` | Manifest + company row + revision count + snapshot; includes `manifestHashMatch` and a `workbookSummary` (sheets, formula count, cached errors, input gate) |
| `filings_sync` | Shared service: live backend fetch (unified model data + SEC filings list via `GET /api/company/{ticker}/filings`), latest filing selected from the filings list for watch/update-ready reporting, normalized snapshot stored, watch updated; never writes workbooks |
| `filing_latest` | Latest stored snapshot / update-ready flag plus `fetchedAt`, `ageHours`, `stale` (>24h), `lastCheck`; read-only, no network |
| `workbook_read_cells` | Live cached values + formulas for up to 50 `{sheet, cell}` refs; read-only |
| `workbook_validate` | Full xlsx inspection (same helper as CLI review): manifest/hash match, sheet + formula counts, cached formula errors, Input Required gate status. Reports `fullValidation: false` with a reason when the inspection engine is unavailable instead of pretending a hash check is full validation; read-only, no network |
| `source_snapshot` | Stored normalized snapshot, paged (`offset`, `maxChars` 1–20000, default 4000; returns `totalChars`, `nextOffset`, `truncated`); read-only, no network |
| `proposal_create` | Validates (exactly one of `proposedValue`/`proposedFormula`, `=`-prefixed formulas), defaults the base to the manifest hash and refuses stale bases, captures each cell's current literal/formula as `priorValue`/`priorFormula`, inserts with status `proposed` |
| `proposal_apply` | Requires `approval: true`; runs the SAME shared apply service and returns revision info — it DOES modify the library through the approved path |
| `proposal_reject` | Status-only rejection; never alters the workbook |

`source_snapshot` returns normalized facts and per-fact source lineage, not
full SEC filing narrative text. For narrative review, the assistant follows
the primary-document reference (or CIK + accession through the SEC archive
index) with its available SEC research tool. If unavailable, it must state
that only the structured snapshot was reviewed.

## Watch lifecycle

The monitor validates the company filings endpoint's CIK and ticker against
the issuer profile/request. It does not treat the accession prefix as the
registrant CIK because that prefix identifies the submitting account, which
may be a filing agent.

- `dcf filings sync <ticker>` fetches the latest filing and upserts the snapshot row.
- `dcf watch check [ticker]` refreshes one ticker or all enabled tickers (one-shot).
- `dcf watch run --interval <seconds> [ticker]` polls on the interval; per-ticker
  errors are logged without stopping; snapshots + update-ready flags stored.
- `dcf watch status` shows the read-only table; `pause`/`resume` toggle flagging.
- Check failures record `last_error`/`last_check` without clearing prior state.

## Approval workflow

1. `dcf filings sync <ticker>` (or `dcf watch check`) queues a snapshot and
   flags update-ready. The workbook is untouched.
2. `dcf model review <ticker>` runs static checks and the real xlsx inspection.
3. `dcf model propose-update` records a sourced proposal (`proposed`).
4. A human reviews the markdown proposal.
5. `dcf model apply <id> --approve` (or MCP `proposal_apply` with
   `approval: true`) runs the shared apply service and publishes a new revision.
6. `dcf model reject <id>` only flips status; the workbook is unchanged.

No step auto-applies. The watcher never edits workbooks.

## Review skill

`.superpowers/skills/dcf-model-review/SKILL.md` covers source checks,
formula/tie-out review, the proposal format, and the approval requirement
for AI-assisted review sessions.
