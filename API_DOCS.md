# Backend API Documentation

The CLI starts `python -m app.local_server`, which binds FastAPI to a temporary loopback port and publishes the port through `DCF_BUILDER_BACKEND_PORT=<port>`. For manual API work, start it from `backend/` with `uvicorn app.main:app --host 127.0.0.1 --port 8000`.

## Service

- `GET /`: service name and version
- `GET /health`: process health
- `GET /ready`: readiness and cache status
- `GET /api/health`: API and cache health
- `GET /api/cache/stats`: cache statistics

## Company data

- `GET /api/company/{ticker}/unified/native?years=5`: profile, SEC statements, canonical financials, market data, peers, valuation context, quality/completeness metadata, and `model_eligibility`
- `GET /api/company/{ticker}`: profile
- `GET /api/company/{ticker}/financials/native?years=5`: native financial statements
- `GET /api/company/{ticker}/market`: market snapshot
- `GET /api/company/{ticker}/peers`: peer set
- `GET /api/company/{ticker}/filings?form=10-K&limit=10`: recent filings
- `GET /api/company/{ticker}/insider-trades?limit=20`: Form 4 trades

## Excel export

- `POST /api/export/dcf/excel`: accepts the completed DCF export payload and returns an `.xlsx` workbook.

The CLI builds the forecast and scenarios before calling the export endpoint. The backend validates the request with `DcfExportRequest`, then maps the payload into the checked-in Excel template with `openpyxl`. Generic operating-company DCFs use the multi-sheet template; bank/insurance residual income, REIT AFFO, and utility dividend-growth valuations use an editable `Sector Model` sheet. Revenue-multiple and EV/EBITDA workbooks are not implemented and are rejected.

The unified response's `model_eligibility` is computed by the Python canonical classifier. Its company type, preferred model, support flag, allowed models, and blocked reasons are validated by the CLI and drive valuation routing. The CLI does not substitute a generic DCF for an unsupported preferred model. Pydantic response/request schemas are in `backend/app/api/contracts.py`; the TypeScript client parses both wire responses at runtime.

## Other routes

- `GET /api/search?query={QUERY}&limit={N}`: company search
- `GET /api/macro`: macro valuation context

## Data sources

- SEC company/profile/financial data: `edgartools`
- Market data: OpenBB with the Yahoo Finance provider, then Stockdex and direct Yahoo/yfinance fallbacks
- Cache: SQLite under `backend/data/`

Set `EDGAR_IDENTITY` in the environment before making SEC-backed requests. Do not commit real identity values or local cache files. The live CLI integration suite exercises these routes with current SEC, market, macro, and peer data and uses an isolated temporary cache.
