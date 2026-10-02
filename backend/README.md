# Backend Service (FastAPI)

Backend API for DCF Builder. Provides validated unified-company payloads, SEC-native financials, market context, and Excel export.

## Stack

- FastAPI + Uvicorn
- `edgartools` for SEC data
- The market-data adapter in `app/services/finance/market.py`
- SQLite-backed cache repository

## Run Locally

The CLI starts this service automatically during a model run. To run it manually:

```bash
cd backend
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
```

API docs at `http://localhost:8000/docs`.

## Main Route Groups

- `/api/company`
- `/api/search`
- `/api/export`
- `/api/macro`
- `/health`
- `/ready`

## Architecture and contracts

`app.main.create_app(services=None)` constructs the FastAPI application. The default `RuntimeServices` container adapts the SEC, market, peer, macro, cache, and workbook implementations; its ports can be replaced independently. Unified-company responses and DCF export requests use Pydantic contracts in `app/api/contracts.py`. Statement rows retain dynamic fiscal-year columns and source metadata. The Python canonical financial pipeline is the single authority for company type and model eligibility, returned as `model_eligibility` in the unified response.

Model eligibility distinguishes `ready`, `input_required`, and `unsupported`. The workbook export accepts a structured missing-input manifest for implemented routes; it creates blank editable inputs and guards dependent valuation formulas until source and range checks pass. Missing peer denominators remain missing through peer enrichment, even when a reported multiple is present. Unsupported routes do not fall through to a generic DCF workbook.

The initial biotechnology route is issuer-specific to MRNA. Its workbook shows the live SEC pipeline inventory and filing basis, with blank analyst-owned commercial and clinical assumptions, explicit scope controls for early and paused candidates, a 35-year pipeline schedule, and a formula-driven sensitivity grid. No valuation appears until every required value and source note passes review. Other biotechnology issuers remain unsupported until their SEC asset and partner-economics source contracts are mapped.

The initial life-insurance route supports MET and PRU through separate distributable-earnings common-equity DCFs. It preserves their different after-tax/pre-tax segment earnings definitions and keeps RBC, statutory capital, and subsidiary dividend facts at their filed legal-entity scope. Five-year capital-retention and upstream-capacity schedules plus the parent cash/claims bridge are blank, unlocked, source-required inputs; the workbook withholds valuation until the manifest and terminal checks pass. Other life insurers remain unsupported.

The CLI starts `python -m app.local_server`, which binds to loopback on an OS-selected port and emits `DCF_BUILDER_BACKEND_PORT=<port>`. For manual development, Uvicorn remains available on a chosen local port.

## Critical Endpoints

- `GET /api/company/{ticker}/unified/native?years=5`
- `GET /api/company/{ticker}/financials/native?years=5`
- `GET /api/company/{ticker}/market`
- `GET /api/company/{ticker}/peers`
- `GET /api/search?query=...&limit=...`
- `POST /api/export/dcf/excel`

## Environment

Copy from `.env.example` and set production values in deployment platform:

- `EDGAR_IDENTITY`
- `CORS_ORIGINS`
- `ALLOWED_HOSTS`
- `EXPOSE_IDENTITY_HINT`

Optional:

- `FINANCIALS_OPERATING_COMPANY_FILTER`
- `FINANCIALS_REQUIRE_10K_PREFLIGHT`
- `SINGLE_TICKER_CACHE`
- `LOG_LEVEL`
- `REQUEST_LOG_ENABLED`
- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_REQUESTS`
- `RATE_LIMIT_WINDOW_SECONDS`

## Data Provider Priority

- Financials/profile: `edgartools` primary.
- Market: OpenBB's Yahoo Finance provider, then Stockdex and direct Yahoo/yfinance fallbacks.

## Cache Notes

- Financial/profile, market, peers, and macro context are cached behind the API.
- Cache stats available via `/api/cache/stats`.
- Purge old cache when changing normalization or schema behavior.
- SQLite cache is acceptable for low-traffic Cloud Run deployments, but it is per-instance and disposable.

## Production Guardrails

- Request/response observability headers:
  - `X-Request-ID`
  - `X-Response-Time-Ms`
- Health endpoints:
  - `/health`
  - `/ready`
  - `/api/health`
- Conservative in-memory API rate limiting enabled by environment variables.

## Live integration checks

From the repository root, run `npm run test:backend`. It runs the 79-test live `dcfbuild` suite across complete, incomplete, and unsupported cases for operating, EV/EBITDA, EV/Revenue, commercial-bank, P&C-insurance, life-insurance, equity-REIT, traditional asset-manager, telecom, regulated-utility, agency mortgage-REIT, integrated-energy, mature-pharma, and MRNA's input-required pipeline-biotech route. Incomplete checks use live source gaps, then inspect workbook formulas and LibreOffice recalculation after blank, invalid, and restored entries. Unsupported subtype cases cover other life insurers, other biotechnology issuers, mixed-utility NEE, and fallback-only peer coverage; DUK uses an input-required utility model. The suite requires network access and `EDGAR_IDENTITY`; each company run uses an isolated temporary cache.
