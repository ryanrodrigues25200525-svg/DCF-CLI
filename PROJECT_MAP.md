# Project Map

## Command flow

- `bin/dcf.mjs`, legacy `bin/dcfbuild.mjs`, and `model/src/cli.ts`: public command entry and thin CLI composition for prompt/flags, local service lifecycle, job, output writer, and valuation summary.
- `model/src/application/run-valuation-job.ts`: maps validated unified data, creates assumptions and valuation, and builds the export request.
- `model/src/api/backend-client.ts` and `model/src/api/contracts.ts`: HTTP client and runtime parsing for unified data and workbook-export contracts.
- `model/src/infrastructure/local-backend-process.ts` and `output-writer.ts`: loopback backend lifecycle and validated workbook file output.
- `model/src/services/integration/sec/native-normalizer.ts`: converts the backend's unified native payload into model inputs.
- `model/src/services/dcf/`: assumption policy, forecasts, terminal value, scenarios, and sensitivities.
- `model/src/services/valuation/router.ts`: routes backend-authoritative model eligibility to DCF or specialist valuation formulas.
- `model/src/services/exporters/excel/`: converts model state to the export payload.
- `model/src/library/`, `model/src/review/`, and `model/src/watch/`: persistent company workbooks, revisions, proposals, and filing snapshots.
- `model/src/mcp/server.ts`: local stdio MCP tools backed by the same application services as the CLI.
- `backend/app/main.py` and `backend/app/services/runtime.py`: app factory and replaceable SEC, market, peer, macro, cache, and workbook service ports.
- `backend/app/api/contracts.py`: validated unified-response and workbook-export schemas.
- `backend/app/services/valuation/classifier.py`: single company-type and model-eligibility authority.
- `backend/app/api/routers/financials_router.py`: unified company data, SEC statements, market data, peers, and valuation context.
- `backend/app/api/routers/export_router.py` and `backend/app/services/excel_export/service.py`: export transport and optional peer enrichment.
- `backend/app/services/excel_export/mappers/`: generic/specialist workbook mapping and formulas.
- `backend/app/local_server.py`: loopback ephemeral-port launcher used by the CLI.
- `backend/app/assets/templates/dcf-export-template.xlsx`: workbook template.

## Model coverage

The CLI has separate formula routes for operating-company DCFs, comparables,
banks, insurance, equity and mortgage REITs, asset managers, telecom, energy,
pharma, biotech, life insurers, and utilities. Each route has issuer-specific
source and eligibility gates; missing required facts produce an input-required
workbook or a clear blocked result. See [Model coverage](docs/MODEL_COVERAGE.md)
for tested examples and boundaries. Coverage is not universal by sector.

## Local run

1. Install model and backend requirements with `npm run install:all`.
2. Set `EDGAR_IDENTITY` in the shell.
3. Configure the model library with `dcf config models-dir --set <path>`.
4. Build and review a company model with `dcf build AAPL` and `dcf model review AAPL`.

The CLI starts FastAPI on a temporary loopback port, calls the data and export
routes, validates/recalculates the workbook, and saves a versioned copy to the
configured model library. The legacy `dcfbuild AAPL` command still exports a
standalone workbook to `~/Downloads` by default.
