# CLI Operations

## Runtime requirements

- Node.js 22.5 or newer for the TypeScript model CLI.
- Python 3.11 and the dependencies in `backend/requirements.txt` for data retrieval and workbook export. `npm run install:all` also installs the OpenBB SDK entrypoint with its Yahoo Finance provider, without optional paid-provider keys.
- LibreOffice (`soffice`) for workbook recalculation and validation. Set `SOFFICE_PATH` if it is outside the normal search paths.
- `EDGAR_IDENTITY` in the shell environment for SEC requests.

Run `npm run install:all` once to install Node dependencies and create
`backend/.venv`, then run `npm run install:command` to add both `dcf` and
`dcfbuild` under `~/.local/bin`.

## Build and review a model

```bash
dcf config models-dir --set "$HOME/DCF-Models"
dcf build AAPL
dcf model review AAPL
dcf model open AAPL
```

The build starts FastAPI on a temporary loopback port, requests live source
data, exports a formula-driven workbook, recalculates it with LibreOffice, and
stores a new revision in the model library. It also writes a dated
`YYYY-MM-DD_AAPL_DCF.xlsx` export under `~/Downloads` (UTC build date; repeated
same-day exports use a numeric suffix). Use `dcf model update AAPL` for an
earnings refresh from the latest data mapped by that route. This deterministically
builds and validates a new accepted revision; then review the dated file with
ChatGPT/Codex. `dcf model review` checks workbook structure, formulas, cached
formula errors, required-input status, and source-review rows.

After reviewing and approving a sourced proposal, `dcf model export AAPL`
copies the accepted library workbook to another dated upload file. It refuses
to export a manually diverged library workbook.

For a separate standalone file, use `dcfbuild AAPL --output <file.xlsx>`.
Its default filename is date-and-ticker stamped; explicit output paths refuse
to replace an existing file unless `--force` is supplied.

## Library, proposals, filings, and MCP

- `dcf models list [--json]` finds saved company workbooks.
- `dcf model inspect AAPL [--json]` checks route, source accession, revision,
  and workbook hash.
- `dcf model propose-update AAPL --change 'sheet|cell|proposed|rationale|source[|accession]'`
  records a source-backed proposal; `dcf model apply <id> --approve` applies it
  as a new revision and `dcf model reject <id>` rejects it without changes.
  Applying requires explicit approval and refuses on a manually diverged copy.
- `dcf filings sync AAPL` refreshes filing metadata and queues an update; it
  never edits a workbook.
- `dcf watch status|check [ticker]|run [--interval <seconds>] [ticker]|pause <ticker>|resume <ticker>`
  tracks filing readiness; `run` polls until interrupted.
- `dcf config models-dir [--set <dir>]` shows or persists the library root.
- `dcf mcp` starts the local stdio MCP server (takes no arguments;
  `dcf mcp --help` prints usage). Applying a proposal over MCP still requires
  explicit approval.

The full command reference is the [model-library guide](docs/MODEL_LIBRARY.md).

The SQLite provider cache in `backend/data/` persists between runs. Live tests
use temporary caches. The local service inherits `EDGAR_IDENTITY` and the
optional `DCF_CACHE_DB_PATH` from the caller.

## Common failures

- **Identity placeholder:** set `EDGAR_IDENTITY` in the current shell, then rerun.
- **No usable financial history:** check the ticker and SEC filing coverage.
- **Input-required model:** a company route is recognized but a required fact or analyst input is missing. The workbook leaves it blank and withholds valuation until completed.
- **Unsupported business type:** the requested issuer/subtype does not meet a supported source contract. The CLI blocks the route rather than substituting a generic DCF.
- **Backend startup error:** install the backend requirements with `npm run install:all` and retry.

## Data privacy

The test suite is live and needs network access, `EDGAR_IDENTITY`, and
LibreOffice. Run `npm run typecheck` and `npm run test:model`. The live suite
covers named complete and input-required routes; it does not claim universal
sector coverage. It uses temporary test caches and does not write or print the
identity value.
