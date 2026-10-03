# Model Library

Local-first persistent library for DCF workbooks. A proposal is applied only
after it has been previewed as a separate validated candidate and then
explicitly approved by a human; apply never builds a candidate inline. The
TypeScript valuation engine is the single calculation core; Python
(`backend/.venv`, openpyxl) owns SEC retrieval,
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

> **AI-in-the-loop completion gap:** `dcf build` and `dcf model update` still
> publish a deterministically validated revision before an AI review. The
> separate proposal-preview flow below is enforced for proposal edits, but the
> pending-candidate/AI-review/human-approval gate for every initial build and
> earnings refresh is not implemented yet. Track it in
> [Issue #20](https://github.com/ryanrodrigues25200525-svg/DCF-CLI/issues/20)
> and the [project completion plan](PROJECT_COMPLETION_PLAN.md). Treat a
> standalone CLI build as model-generated, not AI-reviewed.

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
- `revisions/<revId>.xlsx` — immutable history copies (parent hash + note). The
  revision row also stores the build event, the mapped fact
  accession/filed date/period, the latest detected filing
  (form/accession/filed/report date), route, readiness, and build timestamp;
  older databases migrate idempotently and read missing columns as null.
- `proposals/<proposal-id>/candidate.xlsx` — the validated candidate from
  `dcf model preview`, with an `AI Change Log` sheet. Always its own copy,
  never `current.xlsx`.
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
| `dcf model compare <ticker> [--from <rev>] [--to <rev>] [--offset <n>] [--limit <n>] [--json]` | Read-only comparison of two revisions: formula/value cell changes plus route, readiness, mapped fact period, and latest-detected-filing deltas with filing-freshness notes. Defaults: `--to` is the accepted revision and `--from` its predecessor/parent. Cell changes page with `offset`/`limit` (1–500, default 100). Writes nothing |
| `dcf model propose-update <ticker> --change 'spec'` | Records a sourced proposal (status `proposed`); reads each targeted cell's current literal/formula into `priorValue`/`priorFormula` at creation and shows them in the markdown preview; workbook untouched |
| `dcf model propose-update <ticker> --review-only --summary <text> --verification <text> [--accession <acc>]` | Records a zero-edit review-only proposal with the AI summary and verification result; workbook untouched |
| `dcf model preview <proposal-id>` | Builds a separate validated candidate with an `AI Change Log` sheet (recalculates with LibreOffice; refuses on new cached errors, lost sheets, or unverified cells). Accepted workbook, manifest, and revisions untouched |
| `dcf model apply <id> --approve [--by name]` | Promotes a previously previewed candidate as a new accepted revision after re-validation. A preview is required: without a stored candidate, apply refuses instead of building inline (see below) |
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

Change spec: `sheet|cell|proposed|rationale|source[|accession]`. A leading `=`
in `proposed` is an explicit formula edit; plain numeric literals (including
exponent notation) become numbers, `true`/`false` become booleans, and
`__BLANK__` clears the cell. The accession must be the accepted manifest
accession or a stored snapshot accession — unknown filings are refused.
Creation reads each targeted cell's current literal/formula into
`priorValue`/`priorFormula` and shows them in the markdown preview. Every change
needs a filed `source` + SEC `accession`; unsourced values are rejected.
`--summary` sets the proposal summary; `--accession` sets the source filing
accession. A review-only proposal (`--review-only`, no `--change`) needs a
non-empty `--summary` and `--verification` and may cite one filing accession.

## Compare revisions (`model/src/review/compare.ts`)

`dcf model compare` and the MCP `model_compare` / `revisions_list` tools share
one read-only service. They never write workbooks, manifests, or index rows; the
MCP path opens the existing SQLite file read-only with no directory creation and
no schema migration, and the CLI compare uses the read-only open too.

Each revision records both the filing actually mapped into the workbook facts
(`fact accession/filed date/period`) and the latest detected filing at build
time (form/accession/filed/report date). When they differ, the output states
plainly that the newer filing was **not** mapped into the workbook — an
annual-only route is never described as quarter-updated. Revisions that predate
this metadata show workbook cells only; a revision with no mapped fact
accession but stored latest-filing metadata reports that latest filing as
unconfirmed rather than as predates-tracking. Each archived revision workbook
is verified byte-for-byte against its recorded SHA-256 before comparing: a
missing or diverged archive falls back to `current.xlsx` only when those
bytes exactly match the recorded hash, otherwise comparison fails closed.

Defaults: `--to` is the accepted (manifest) revision, else the newest; `--from`
is the latest strictly earlier revision whose hash matches `--to`'s parent hash,
else the next-older revision, else `--to` itself (an explicit no-change compare).
A single-revision library compares with itself. The cell list pages with
`offset`/`limit` (CLI) or `offset`/`maxChanges` (MCP, 1–500, default 100):
`hasMore`/`nextOffset` point at the next detail page (stop when `hasMore` is
false) while `truncated` flags only the hard collection cap; `--json` prints
the same object as the MCP tool.

## Candidate preview (`model/src/review/apply-service.ts`)

`dcf model preview <proposal-id>` (MCP `proposal_preview`) is read-only toward
the accepted workbook. It re-checks the manifest + on-disk hash + proposal base,
applies the validated proposal to a **copy**, adds an `AI Change Log` sheet, and
recalculates with LibreOffice `soffice`. The candidate is written under
`companies/<TICKER>/proposals/<id>/candidate.xlsx`, and its path/hash plus a
deterministic validation summary are stored in proposal metadata only after
every check passes. A failed or repeated preview never changes `current.xlsx`,
`manifest.json`, or revisions; a previous candidate is restored if a later step
fails.

The `AI Change Log` sheet is plain text (no live formulas) and records the
proposal id, ticker, base revision, AI summary, verification result, filing
accession, validation result, and one row per cell change with prior/proposed
value or formula, rationale, source, and accession. A review-only proposal
records that no cell changes were recommended.

Promotion is the existing explicit approval step, and a preview is mandatory.
`dcf model apply <id> --approve` (MCP `proposal_apply` with `approval: true`)
requires a stored, previewed candidate and re-validates it — accepted workbook
still at the preview base, draft unchanged, candidate bytes matching the stored
hash, cached formula errors and sheet/formula counts re-checked, `AI Change Log`
present, targeted cell contents re-inspected — then publishes through the
staged sequence below. Apply never builds a candidate inline: without a stored
candidate it refuses and points to `dcf model preview`. Rejection
(`dcf model reject <id>`) only flips status; the accepted workbook is unchanged.

## Apply (`model/src/review/apply-service.ts`)

`applyApprovedProposal` is shared by the CLI and MCP. A preview is required:
it refuses when the proposal has no stored candidate instead of building one
inline. It rechecks the manifest + on-disk hash + proposal base immediately
before promoting (`MANUAL_EDIT_DETECTED`/stale aborts; nothing changed), then
re-validates the stored candidate — preview base still current, draft hash
unchanged, candidate path and SHA-256 match, cached formula errors, sheet and
formula counts, `AI Change Log` presence, and targeted cell contents — and
stages the candidate bytes next to `current.xlsx`. Publication is staged, not
claimed atomic: rollback copies/state (prior workbook bytes, manifest text,
company/watch rows, proposal status) are retained, then the revision row,
archive copy, same-directory rename into `current.xlsx`, `manifest.json`,
index, and proposal `applied` + audit are committed in order. The new revision
inherits the prior revision's mapped fact accession/period and route/filing
context (never inventing a period) and records the apply event, approver, and
proposal source in its note. Any publication failure triggers rollback
restoring `current.xlsx`, `manifest.json`, and the SQLite
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
| `proposal_create` | Validates (exactly one of `proposedValue`/`proposedFormula`, `=`-prefixed formulas), defaults the base to the manifest hash and refuses stale bases, captures each cell's current literal/formula as `priorValue`/`priorFormula`, inserts with status `proposed`. Pass `changes: []` with a non-empty `summary` and `verification` for a review-only proposal |
| `proposal_preview` | Builds the validated candidate for a proposal (adds an `AI Change Log`, recalculates cached formulas, validates) and returns `inspectionMarkdown` plus each applied cell's prior/proposed literal or formula; accepted workbook untouched, no approval required |
| `proposal_apply` | Requires `approval: true` AND a stored previewed candidate; re-validates that candidate, runs the SAME shared apply service, and returns revision info — it DOES modify the library through the approved path and never builds a candidate inline |
| `proposal_reject` | Status-only rejection; never alters the workbook |
| `revisions_list` | Revision history with filing/event metadata (build event, mapped fact accession/period, latest detected filing, route/readiness); paged (`offset`/`limit` 1–100); read-only |
| `model_compare` | Same data as `dcf model compare`: cell/formula changes plus source and readiness deltas; read-only, paged (`offset`/`maxChanges` 1–500; `hasMore`/`nextOffset` page, `truncated` flags the hard cap) |

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
2. `dcf model review <ticker>` runs static checks and the real xlsx inspection;
   `dcf model compare <ticker>` shows what changed since the prior revision,
   including whether a newer filing was mapped.
3. `dcf model propose-update` records a sourced proposal (`proposed`), or a
   review-only proposal with `--review-only --summary --verification`.
4. A human reviews the markdown proposal and runs `dcf model preview <id>` to
   build the candidate with its `AI Change Log`. Preview is required for every
   proposal, including review-only ones, and is read-only toward the accepted
   workbook.
5. `dcf model apply <id> --approve` (or MCP `proposal_apply` with
   `approval: true`) re-validates the stored candidate and publishes a new
   revision. Apply never builds inline and preserves the prior revision's
   filing/route metadata.
6. `dcf model reject <id>` only flips status; the accepted workbook is unchanged.
7. `dcf model export <ticker>` writes a new dated copy of the accepted revision.

No step auto-applies. The watcher never edits workbooks. There is no autonomous
LLM in the Python/TypeScript engine: a ChatGPT/Codex agent invokes these tools,
and a workbook is AI-reviewed only when an agent actually ran the review.

## Review skill

`.superpowers/skills/dcf-model-review/SKILL.md` covers source checks,
compare/freshness review, formula/tie-out review, the proposal format, the
candidate `AI Change Log`, and the approval requirement for AI-assisted review
sessions.
