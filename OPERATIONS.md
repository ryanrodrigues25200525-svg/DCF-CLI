# CLI Operations

## Runtime requirements

- Node.js 22.5 or newer for the TypeScript model CLI.
- Python 3.11 and the dependencies in `backend/requirements.txt` for data retrieval and workbook export. `npm run install:all` also installs the OpenBB SDK entrypoint with its Yahoo Finance provider, without optional paid-provider keys.
- `EDGAR_IDENTITY` in the shell environment for SEC requests.

Run `npm run install:all` once to install the Node model dependencies and create `backend/.venv`, then run `npm run install:command` from this project folder to install `dcfbuild` under `~/.local/bin`.

## A model run

Run `dcfbuild` to be prompted for a ticker, or use `dcfbuild AAPL`. The command starts the API on a temporary loopback port, checks `/ready`, requests the unified company payload, calls the Excel export endpoint, saves `<ticker>_dcf.xlsx` under `~/Downloads`, and stops the service process. It refuses to overwrite an existing workbook unless `--force` is supplied. Use `--output <file>` to select a different path explicitly. Each workbook is an editable draft with formulas and a `Data Review` sheet listing source-quality and mapping warnings. Banks and insurers receive a residual-income sheet, REITs receive an AFFO sheet, and utilities receive a dividend-growth sheet.

The SQLite cache in `backend/data/` persists between runs. It is disposable; removing it causes providers to fetch data again. The child process receives a small environment allowlist, including `EDGAR_IDENTITY` and the optional `DCF_CACHE_DB_PATH` used to isolate a cache.

## Common failures

- **Identity placeholder:** set `EDGAR_IDENTITY` in the current shell, then rerun.
- **No usable financial history:** check the ticker and SEC filing coverage.
- **Missing price or shares:** market data or SEC share data was not available; the CLI stops instead of exporting a partial model.
- **Unsupported business type:** the company needs a sector model that is not implemented. Residual income, REIT AFFO, and utility dividend-growth workbooks are currently supported.
- **Backend startup error:** install the backend requirements with `npm run install:all` and retry.

## Data privacy

The CLI test suite is live. Run `npm run test:model` or `npm run test:backend` with network access and `EDGAR_IDENTITY` configured. It checks current AAPL, JPM, AIG, PLD, NEE, and MRNA responses, exports supported workbooks, and uses a new temporary cache for each ticker. It does not write the identity value into workbooks or print it in CLI output.
