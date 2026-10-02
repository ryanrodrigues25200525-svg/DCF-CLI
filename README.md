# DCF CLI

Local command line and MCP tools for building, saving, reviewing, and revising sector-specific Excel valuation models from SEC filings and market data.

Workbooks contain native, editable Excel formulas. Model assumptions and formulas can be changed in a spreadsheet app. Missing source inputs withhold valuation, and proposed updates require explicit approval before a new workbook revision is accepted.

## Quick start

Requirements:

- Node.js **22.5 or newer**, Python **3.11 or newer**, and Internet access.
- An SEC identity supplied through `EDGAR_IDENTITY`.
- A working LibreOffice `soffice` executable for library builds and approved updates. Set `SOFFICE_PATH` when it is outside the normal search paths.

```bash
git clone https://github.com/ryanrodrigues25200525-svg/DCF-CLI.git "DCF CLI"
cd "DCF CLI"
npm run install:all
export EDGAR_IDENTITY="Your Name your-email@example.com"
npm run install:command
dcf config models-dir --set "$HOME/DCF Models"
dcf build AAPL
dcf model open AAPL
```

The installer provides `dcf` and the legacy `dcfbuild` command under `~/.local/bin`. If that folder is absent from the current shell's PATH, open a new terminal or use `npm run dcf -- build AAPL` from this checkout. Keep real identity values in your local environment, not in source files.

For a standard macOS LibreOffice installation:

```bash
export SOFFICE_PATH="/Applications/LibreOffice.app/Contents/MacOS/soffice"
```

## Model library and commands

`DCF_MODELS_DIR` overrides the configured folder for a process. `--models-dir <dir>` overrides it for one command. Without either, the configured path is used, then `~/DCF-Models`.

```text
<models-dir>/
  library.db
  companies/AAPL/
    current.xlsx
    manifest.json
    revisions/<revision-id>.xlsx
```

The manifest records route, currency, unit scale, source accession, readiness, workbook hash, and revision. Proposals and source snapshots are kept in SQLite. Revisions preserve accepted workbook copies; hash checks detect manual edits before replacement.

| Command | Purpose |
| --- | --- |
| `dcf build AAPL` | Build, recalculate, validate, and save a model revision |
| `dcf models list` | List saved company models |
| `dcf model inspect AAPL` | Inspect metadata, revision history, and workbook hash |
| `dcf model open AAPL` | Open the current workbook in the default spreadsheet app |
| `dcf model review AAPL` | Inspect formulas, cached errors, sources, and missing inputs |
| `dcf filings sync AAPL` | Refresh source data and queue a filing for review |
| `dcf model propose-update AAPL --change 'Sheet\|Cell\|ValueOrFormula\|Reason\|Source\|Accession'` | Record a sourced proposal with captured prior cell values/formulas |
| `dcf model apply <proposal-id> --approve` | Apply approved changes to a copy and save a new revision |
| `dcf model reject <proposal-id>` | Reject a proposal while retaining the workbook |
| `dcf watch run --interval 300` | Poll enabled companies and store update-ready snapshots |
| `dcf watch status` | Show filing-monitor status |
| `dcf config models-dir --set <absolute-path>` | Change the persistent model-library folder |

Approved updates preserve the previous revision, apply the requested cell values/formulas, recalculate with LibreOffice, and validate before publishing. A leading `=` in a proposed value is an explicit formula edit. A manual-edit or stale-base conflict stops application. `dcf build --force` archives a diverged workbook before rebuilding.

The legacy standalone export remains available:

```bash
dcfbuild AAPL
dcfbuild MSFT --output ./models/msft.xlsx
```

It prompts for a ticker when omitted and defaults to `~/Downloads/<ticker>_dcf.xlsx`. Use `--force` to explicitly replace that output file.

## Local MCP and AI review

Start the stdio server:

```bash
npm --prefix model run dcf-mcp --silent
```

For a client supporting local stdio MCP, configure the absolute path to `model/node_modules/.bin/tsx` as the executable, with `--tsconfig <absolute-path>/model/tsconfig.json` and `<absolute-path>/model/src/mcp/server.ts` as arguments. Supply `EDGAR_IDENTITY`, `DCF_MODELS_DIR`, and optionally `SOFFICE_PATH` through the client's local environment settings.

The server exposes model listing/inspection, selected cell/formula reads, validation, filing sync/status, paged source snapshots, and proposal create/apply/reject. The CLI, MCP server, and watcher share application services and the existing TypeScript valuation engine; Python handles SEC data and Excel export/inspection.

AI review uses normalized SEC/OpenBB facts, sources, and workbook cells. Full filing narrative sections require the assistant's SEC research tool. Applying an MCP proposal requires `approval: true` after the human approves the specific changes.

See the [model-library guide](docs/MODEL_LIBRARY.md), [review skill](.superpowers/skills/dcf-model-review/SKILL.md), and [execution plan](docs/superpowers/plans/2026-10-02-dcf-cli-mcp-model-library.md).

## Data and model coverage

- Financial statements and company profiles come from SEC filings through `edgartools`.
- Market quotes and company market metadata use OpenBB with Yahoo Finance as the selected provider. A direct Yahoo chart request remains as a fallback if the provider quote fails or is rate-limited; SEC shares fill the market cap when necessary.
- `npm run install:all` installs only OpenBB's core, equity, and Yahoo extensions. It does not require an FMP or Intrinio API key.
- **Live operating examples:** AAPL (technology hardware), CRM (subscription software), and WMT (consumer retail) use the formula-driven FCFF DCF; CAT (industrial manufacturing) uses a live EV/EBITDA peer model; SNOW (subscription software) uses a live EV/Revenue peer model when its DCF inputs are incomplete.
- Core DCF assumptions begin from filed history. Hardware, software, retail, industrial, and semiconductor profiles use editable assumptions with three-year filed margin and reinvestment calculations. Software working capital reconciles to filed noncash current assets less current liabilities when trade payables or inventory are not separately disclosed.
- DCF eligibility requires a current curated peer set for its terminal multiple, dated market rates, beta, market capitalization, filed debt and tax inputs, and a filed common-equity bridge. Missing interest expense does not default to a guessed cost of debt.
- Fallback, duplicate, thin, stale, or unreconciled peer sets do not support a multiple valuation. TGT is a live input-required example for a retailer that only has a fallback peer universe; fallback peers are not inserted into the workbook.
- **Validated live traditional asset managers:** BlackRock (BLK) and T. Rowe Price (TROW) use `asset_manager_aum_dcf`. Live SEC tests cover AUM rollforwards, fee-component revenue reconciliation, filed operating inputs, common-equity bridges, formula workbooks, and LibreOffice recalculation. The forecast starts with FY2025 filed annual actuals; the model does not yet roll in 2026 quarterly AUM data.
- **Validated live telecommunications example:** AT&T (T) uses `telecom_subscriber_dcf`. Its subscriber, churn, broadband, segment revenue, operating income, capital expenditures, interest-bearing debt, debt cost, and working-capital inputs map to the FY2022–FY2025 SEC filings, and the dedicated formula workbook has passed LibreOffice recalculation and engine-parity checks. FY2025 remains the operating base; FY2026 quarterly changes and subsequent acquisitions/spectrum transactions are not included. Verizon (VZ) receives an input-required workbook listing its missing subscriber and segment data; it does not yet receive the dedicated telecom formula schedule or a valuation.
- **Validated live agency mortgage REIT:** AGNC uses `mortgage_reit_residual_income`. Its formula workbook keeps GAAP interest separate from TBA/swap economic funding, models swap hedge coverage and net pay rate explicitly, reconciles three years of common book value and a balance-sheet check, and values common equity from tangible book plus residual income. It does not calculate enterprise value. FY2025 is the latest annual operating base; FY2026 quarterly results are not included. Commercial mortgage REITs such as STWD and other issuers remain blocked until their credit, servicing, and financing schedules have separate source contracts.
- **Validated live integrated-energy example:** Exxon Mobil (XOM) uses `integrated_energy_dcf`, with separate production, realized-price, unit-cost, reserves, GAAP segment earnings, corporate financing, Cash CapEx, and working-capital schedules. The formula workbook passed live SEC-source checks, LibreOffice recalculation, engine parity, sensitivity direction, and formula-error checks. It uses FY2025 as the latest annual base; later quarterly activity is not included. CVX, independent E&Ps, miners, and other energy issuers remain blocked pending issuer-specific source contracts.
- **Validated live mature-pharma example:** Pfizer (PFE) uses `mature_pharma_product_dcf`. Its formula workbook separates product sales, U.S./major-Europe/Japan basic patent dates, an editable modeled global LOE year, pre-LOE growth, and post-LOE erosion assumptions before the FCFF DCF. FY2025 is the latest annual base; pipeline NAV is excluded. Merck (MRK) and other mature-pharma issuers remain blocked until their source contracts pass live checks.
- **Input-required biotech pipeline model:** Moderna (MRNA) uses `biotech_pipeline_rnpv`. Its SEC asset inventory, stage, partner, filing basis, commercial DCF, asset-level launch/ramp/PoS/retained-share/cost formulas, 35-year pipeline schedule, and WACC/terminal-growth sensitivity are visible in Excel. Commercial and clinical assumptions remain blank analyst inputs with required sources; paused and early-stage programs get explicit inclusion controls and individual residual-rNPV inputs. The CLI reports no valuation until all required inputs pass. This is an MRNA-only source contract; other biotechs remain blocked.
- **Life-insurer distributable-earnings model:** MET and PRU use issuer-specific 10-K segment earnings bases, preserve statutory-capital and dividend disclosures by legal-entity scope, and receive an input-required common-equity DCF workbook. Capital additions/releases, upstream capacity, parent-company cash/reserve/debt/claims, and missing market inputs remain blank and source-required; no valuation is shown until they are completed. Other life insurers remain unsupported pending their own source contracts.
- **Other input-required and blocked boundaries:** NVDA has an incomplete EV/EBITDA route while its source-backed common-equity bridge is incomplete. Duke Energy (DUK) has an input-required rate-base DDM because its jurisdictional regulatory facts are not mapped; NEE remains blocked while regulated and unregulated operations are not separated. IVZ's base-fee/AUM history is not yet mapped; alternatives such as BX/KKR need a separate carry/principal-investment model.
- **Validated live commercial banks:** JPMorgan Chase (JPM) and Bank of America (BAC). Goldman Sachs (GS) is classified as an investment bank and is blocked.
- **Validated live P&C example:** AIG. Its General Insurance operations and Other Operations are shown separately, while its statutory capital-to-premium test remains a disclosed proxy. Other insurer subtypes remain blocked.
- **Validated live equity REIT example:** Prologis (PLD). Analyst AFFO is Core FFO less tenant improvements, leasing commissions, and all reported property improvements treated as recurring. Its NAV cap rate starts at the current market-implied rate, and the property NAV excludes Strategic Capital and other corporate/non-property items.
- **Incomplete workbooks verified:** Live-source redactions exercise AAPL operating DCF, JPM bank, AIG P&C insurance, PLD equity REIT, AGNC mortgage REIT, BLK asset manager, AT&T telecom, XOM integrated energy, PFE mature pharma, MRNA biotech pipeline, CAT/SNOW comparables, and DUK regulated-utility rate-base DDM. Required inputs are blank, blue, and editable; LibreOffice checks confirm guarded outputs remain blank until restored. MRNA and DUK scenarios also check invalid inputs, formula edits, sensitivities, and engine parity. These checks demonstrate the named routes, not universal sector coverage.
- **Regulated utilities:** Duke Energy (DUK) receives an input-required rate-base DDM. Its jurisdiction-level rate base, allowed ROE, authorized equity ratio, rate-base additions, and depreciation must be entered with source references before the workbook displays a value. NextEra Energy (NEE) remains blocked until regulated and unregulated cash flows and capital bases can be separated.
- The bank workbook projects CET1 as opening CET1 plus net income less common distributions. It does not separately forecast regulatory deductions, AOCI, or supervisory adjustments; this is disclosed in `Data Review`. The filed minimum CET1 ratio is the editable base input, and users should verify how current supervisory buffers apply.
- JPM, BAC, AIG, PLD, AAPL, CRM, WMT, CAT, and SNOW have issuer-specific live mapping or export checks. These examples validate only the listed model routes; they do not cover every issuer or subtype in those sectors.
- The 79-test live-only suite checks SEC source lineage, formulas, editable input styling, peer medians, incomplete/invalid/restored inputs, short-history timelines, and valuation bridges. It requires network access and `EDGAR_IDENTITY`. Representative complete/incomplete routes include AAPL, CRM, WMT, CAT, SNOW, JPM/BAC, AIG, PLD, AGNC, BLK/TROW, AT&T, DUK, XOM, PFE, MRNA, MET, and PRU. LibreOffice recalculation, formula-error scans, restored-input parity, and direct native-formula edits are covered. For tested cases, restored engine/workbook outputs tie within 0.1% of equity value and $0.01 per share. The suite does not establish that every company in a named sector is supported; unsupported and incomplete boundaries are listed above.
- Data fallback, quality, and mapping warnings are printed and listed on the workbook's `Data Review` sheet.

The CLI does not require the former web or Electron interface. Its headless model logic lives in `model/`; data retrieval and Excel generation live in `backend/`.


## Verification

```bash
npm run typecheck
npm run test:model
```

`test:model` runs the 79-test live suite against real SEC/provider data and workbook exports. The latest complete local run passed **79/79** in 888.69 seconds. Tests validate the fail-closed outcome when real market/rate context is stale or a source composite is incomplete; fresh data still exercises valuation and editable-formula parity checks. Provider statuses can include fresh cached data.

LibreOffice is required for recalculation checks. The current live test file still contains machine-specific LibreOffice paths; making the suite portable is a follow-up task. Generated workbooks, local data, and implementation scratch are excluded from Git.

## Known limits and next work

1. **Correct filing issuer identification.** The current watcher rejects report accessions whose prefix differs from the issuer CIK. The SEC says that prefix identifies the submitting account, which may be a filing agent. Replace this rule with issuer verification from the SEC filing metadata, retaining the endpoint/profile CIK check. Until then, monitoring can miss valid filings. [SEC EDGAR Filer Manual](https://www.sec.gov/files/edgar/filermanual/efmvol2-c2.pdf)
2. **Automate library/MCP recovery checks and portable setup.** Add live acceptance coverage for proposals, manual-edit conflicts, concurrent writes, and crash recovery; use configurable spreadsheet-engine paths and a clean-install workflow.
3. **Broaden source coverage and update periods.** Add issuer source contracts beyond the named examples, quarterly/TTM updates, and direct filing-section retrieval. Current specialist models have the annual and issuer boundaries documented above.

Model calculations live in `model/`; the local FastAPI data/export service lives in `backend/`. The current product runs without the former web or Electron interface.
