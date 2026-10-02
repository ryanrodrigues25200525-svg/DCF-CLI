# CLI Data and Export Flow

```text
dcfbuild AAPL
   |
   +--> Start backend/app/local_server.py; bind loopback and emit its port
   +--> BackendApiClient validates /api/company/{ticker}/unified/native
   +--> RunValuationJob maps SEC statements and market data to model inputs
   +--> Consume Python's authoritative model_eligibility
   +--> Build assumptions, valuation, scenarios, and sensitivities
   +--> Validate and POST the completed payload to /api/export/dcf/excel
   +--> Write <ticker>_dcf.xlsx, then stop the backend
```

## Source Routing

- Company profile and financial statements: SEC filings through `edgartools`.
- Market data: OpenBB with the Yahoo Finance provider, then Stockdex and direct Yahoo/yfinance fallbacks.
- Peers and valuation context: best-effort backend enrichment; missing peers use the model's documented default multiple and add a quality warning.
- Company data, fallbacks, and completeness are returned by `/api/company/{ticker}/unified/native`.

## Model and Workbook

- `model/src/services/integration/sec/native-normalizer.ts` maps the unified payload to model inputs.
- `model/src/services/dcf/assumption-policy.ts` selects and normalizes default assumptions.
- `model/src/services/dcf/engine.ts` calculates the DCF forecast and valuation.
- `model/src/services/exporters/excel/index.ts` assembles base, bull, bear, and sensitivity payloads.
- `backend/app/services/excel_export/` maps the payload into the Excel template using `openpyxl`.

`backend/app/services/valuation/classifier.py` is the single company-type and model-eligibility authority; `model/src/services/valuation/router.ts` consumes its validated result. The CLI owns the run lifecycle; it does not require an already-running API server or browser UI. A route is available only when both its calculation engine and formula workbook mapper are in the production registries. Banks and P&C insurers use common-equity residual-income models, equity REITs use AFFO, and source-ready asset managers, telecom, agency mortgage REITs, integrated energy (XOM), mature pharma (PFE), and MRNA's input-required biotech pipeline route use separate sector models. Other biotech issuers, life insurers, unsupported utilities, and issuer-specific peers remain blocked until their required source schedules are available.
