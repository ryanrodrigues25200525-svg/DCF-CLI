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
stores a new revision in the model library. `dcf model review` checks workbook
structure, formulas, cached formula errors, required-input status, and
source-review rows.

For a separate standalone file, use `dcfbuild AAPL --output <file.xlsx>`.
That legacy command refuses to replace an existing file unless `--force` is
supplied.

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
