# 🧮 DCF CLI

**Build source-backed, sector-aware DCF workbooks from the command line.**
DCF CLI turns live company data into editable Excel models with native
spreadsheet formulas, explicit source trails, model-specific input checks, and
a local revisioned library.

The calculation and validation path is deterministic code. ChatGPT or Codex can
help review sources, explain formulas, and draft changes; the analyst stays in
control of spreadsheet edits and every approved library update.

> **No invented valuation:** if a supported company is missing required facts,
> DCF CLI creates an input-required workbook with blank editable inputs and
> withholds value. If the company does not meet a supported model route, the
> CLI blocks it.

[Quick start](#-quick-start) · [Model gallery](#-model-gallery) ·
[ChatGPT workflow](#-chatgpt--dcf-cli-workflow) ·
[Known issues](BUGS.md)

## ✨ What it does

- 🏢 Routes companies to separate models for operating companies, banks,
  insurers, REITs, asset managers, telecom, energy, pharma, biotech, and
  utilities.
- 📊 Exports **native Excel formulas** that analysts can inspect and edit.
- 🔎 Keeps SEC filing references and source-quality warnings in the workbook’s
  Data Review sheet.
- 🧮 Recalculates and checks workbook structure, formula counts, cached formula
  errors, and missing-input gates before saving a revision.
- 🗂️ Saves workbooks, manifests, revisions, filing snapshots, and proposals in
  a configurable local model library.
- ✅ Requires a separate validated candidate preview and explicit human approval
  before a proposed update becomes a new accepted revision. Apply never builds
  a candidate inline.

DCF CLI does not claim universal coverage by sector. See the
[model coverage guide](docs/MODEL_COVERAGE.md) for tested examples and
issuer-specific boundaries.

## 🚀 Quick start

Requirements: Node.js **22.5+**, Python **3.11+**, LibreOffice, Internet access,
and an SEC identity string in EDGAR_IDENTITY.

```bash
git clone https://github.com/ryanrodrigues25200525-svg/DCF-CLI.git
cd DCF-CLI
npm run install:all
export EDGAR_IDENTITY="Your Name you@example.com"
npm run install:command
dcf config models-dir --set "$HOME/DCF-Models"
dcf build AAPL
dcf model review AAPL
dcf model open AAPL
```

Each default build writes the accepted library copy plus a dated workbook in
`~/Downloads`, named `YYYY-MM-DD_AAPL_DCF.xlsx` using the UTC build date.
Repeated exports of the same ticker on one day add `_02`, `_03`, and so on.
The library keeps its stable `companies/AAPL/current.xlsx` path.
The filename date is an export/build date, not a substitute for the SEC filing
period shown inside the workbook. Some specialist routes still use annual
actuals; see [Model coverage](docs/MODEL_COVERAGE.md) before assuming a refresh
includes a newly reported quarter.

If LibreOffice is outside the normal search paths, set SOFFICE_PATH. For the
standard macOS app install:

```bash
export SOFFICE_PATH="/Applications/LibreOffice.app/Contents/MacOS/soffice"
```

The installer adds dcf and the legacy standalone dcfbuild command under
~/.local/bin. If your shell does not include that directory yet, open a new
terminal or run npm run dcf -- build AAPL from the repo.

Keep your real SEC identity in your local shell environment. Do not add it to
the repo or a checked-in config file.

## 🏦 Model gallery

These are concrete live-checked routes, not claims that every issuer in a
sector is supported. The links open the model implementations; the commands
generate a current workbook from your own live data.

| Example companies | Model | Status | Implementation |
| --- | --- | --- | --- |
| AAPL, CRM, WMT | Unlevered FCFF DCF | Live-verified | [Operating model](model/src/services/valuation/operating-model.ts) |
| CAT, SNOW | EV/EBITDA and EV/Revenue comparables | Live-verified | [Comparable model](model/src/services/valuation/multiple-model.ts) |
| JPM, BAC | Bank residual income | Live-verified | [Bank model](model/src/services/valuation/bank-model.ts) |
| AIG | P&C insurance residual income | Live-verified | [Insurance model](model/src/services/valuation/insurance-model.ts) |
| PLD | Equity REIT AFFO + NAV | Live-verified | [REIT model](model/src/services/valuation/reit-model.ts) |
| AGNC | Agency mortgage REIT residual income | Live-verified | [Mortgage REIT model](model/src/services/valuation/mortgage-reit-model.ts) |
| BLK, TROW | Asset-manager AUM DCF | Live-verified | [Asset-manager model](model/src/services/valuation/asset-manager-model.ts) |
| T | Telecom subscriber DCF | Live-verified | [Telecom model](model/src/services/valuation/telecom-model.ts) |
| XOM | Integrated-energy DCF | Live-verified | [Integrated-energy model](model/src/services/valuation/integrated-energy-model.ts) |
| PFE | Mature-pharma product DCF | Live-verified | [Mature-pharma model](model/src/services/valuation/mature-pharma-model.ts) |
| MRNA | Biotech pipeline rNPV | Input-required | [Biotech rNPV model](model/src/services/valuation/biotech-rnpv-model.ts) |
| DUK | Regulated-utility DCF | Input-required | [Utility model](model/src/services/valuation/utility-model.ts) |

### Try different model types

```bash
# General operating-company DCF
dcf build AAPL
dcf model review AAPL
dcf model open AAPL

# Bank-specific residual-income model
dcf build JPM

# Equity REIT AFFO and NAV model
dcf build PLD

# Recognized route with missing regulatory facts:
# creates blank required inputs and withholds valuation
dcf build DUK

# Earnings refresh for an existing company (same validated build path)
dcf model update JPM
```

Current SEC and market data can change whether a route is complete on a
particular run. An “input-required” result is intentional: the workbook shows
what must be sourced and filled before the valuation can be used. More examples
and limitations are in [Model coverage](docs/MODEL_COVERAGE.md).

No prefilled company workbook snapshots are checked in. The gallery links to
the actual formula engines, and the commands reproduce current workbooks from
your own data sources instead of distributing stale valuations.

## 🔄 How the workflow works

```mermaid
flowchart LR
    A[SEC filings + market data] --> B[Normalize facts and source lineage]
    B --> C{Route and required-input checks}
    C -->|Complete| D[Deterministic valuation engine]
    C -->|Inputs missing| E[Input-required workbook]
    D --> F[Editable native Excel formulas]
    E --> F
    F --> G[LibreOffice recalc and validation]
    G --> H[Local library and revision]
    H --> I[Review and compare with prior revision]
    I --> J[Optional AI proposal: summary + sourced edits]
    J --> P[Candidate preview + AI Change Log]
    P --> K{Human approval}
    K --> H
```

The pipeline separates jobs that need different standards:

1. **Data services** fetch SEC filings and market context, normalize periods,
   units, and provenance, and report data-quality warnings.
2. **The model router** selects a company-specific formula route or stops with
   an input-required/unsupported result.
3. **The valuation engine and exporter** produce readable forecast schedules,
   assumptions, valuation bridges, sensitivities where supported, and native
   Excel formulas.
4. **Workbook checks** recalculate with LibreOffice and scan for missing
   required inputs and formula errors before the library accepts a revision.
5. **The analyst** reviews every assumption, compares revisions, and edits
   formulas or inputs in a spreadsheet app. AI review is optional: a proposal
   stays separate, a preview builds a candidate with its own `AI Change Log`,
   and only explicit approval publishes a revision.

## 🧰 Commands you’ll use

| Command | Use |
| --- | --- |
| `dcf build AAPL` | Build or rebuild, validate, save a library revision, and create a dated export |
| `dcf model update AAPL` | Explicitly refresh from the latest mapped SEC/market data and create a dated export |
| `dcf model export AAPL` | Copy the accepted library revision to a dated file after review or approval |
| `dcf models list` | Find saved company workbooks |
| `dcf model inspect AAPL` | Check route, source accession, revision, and workbook hash |
| `dcf model review AAPL` | Check formulas, workbook errors, sources, and missing inputs |
| `dcf model compare AAPL [--from ID] [--to ID] [--json]` | Compare two revisions: cell changes plus source/model context and filing-freshness notes |
| `dcf model open AAPL` | Open the saved workbook in your spreadsheet app |
| `dcf filings sync AAPL` | Refresh filing metadata and queue an update; it never edits a workbook |
| `dcf watch run --interval 300` | Check enabled companies every 300 seconds |
| `dcf model propose-update AAPL --summary "…" --change '…'` | Save a source-backed proposal; `--review-only --summary --verification` records a review with no cell edits |
| `dcf model preview ID` | Build a separate, validated candidate workbook with an `AI Change Log`; accepted workbook unchanged |
| `dcf model apply ID --approve` | Promote the previewed candidate as a new revision after explicit approval (a preview is required; apply never builds inline) |
| `dcf model reject ID` | Reject a proposal without changing the workbook |
| `dcf mcp` | Start the local stdio MCP server |

The model library can be redirected with DCF_MODELS_DIR or --models-dir PATH.
By default it lives under ~/DCF-Models:

```text
~/DCF-Models/
  library.db
  companies/AAPL/
    current.xlsx
    manifest.json
    revisions/
```

For all options and conflict behavior, see the
[model-library guide](docs/MODEL_LIBRARY.md).

## 🤖 ChatGPT + DCF CLI workflow

Use ChatGPT to **review and explain a model that DCF CLI built**, rather than
asking it to invent a workbook from scratch.

> **The AI step is not autonomous.** No LLM runs inside the Python/TypeScript
> engine. The ChatGPT/Codex agent reads the current model, the deterministic
> checks, the prior-revision comparison, and the stored source snapshot, then
> drafts a proposal; DCF CLI validates, previews, and stores what the agent
> supplies. Never describe a workbook as AI-verified unless you asked an agent
> to run the review.

1. Build or update and validate. Use `dcf build AAPL` for the initial model, or
   `dcf model update AAPL` after a new filing; then run `dcf model review AAPL`.
   When a previous revision exists, `dcf model compare AAPL` shows the cell
   changes and source/model-context deltas between revisions, including whether
   a newer filing was actually mapped into the workbook.

2. Attach the dated workbook path printed by the CLI, for example
   `~/Downloads/2026-10-03_AAPL_DCF.xlsx`, to a ChatGPT conversation. Paste the
   `dcf model compare` output too when you want the prior revision reviewed
   alongside the current one.

3. Ask for a review with a source-first prompt such as:

   > Review this workbook as a financial-model auditor. Map the model route,
   > assumptions, formulas, source references, and valuation bridge. Flag
   > missing or inconsistent inputs and formula errors. Do not invent values or
   > rewrite the workbook. For each proposed factual correction, give the exact
   > sheet and cell, current value or formula, proposed value or formula,
   > rationale, source, and SEC accession. Separate reported facts from analyst
   > assumptions and list the checks you would run after an edit.

4. Record the outcome. A source-backed factual correction becomes a proposal
   with `dcf model propose-update` (one `--change` per edit). A review that finds
   no cell edits can still be recorded with
   `--review-only --summary <text> --verification <text>`. Inspect the proposal,
   then run `dcf model preview <proposal-id>` to build a separate candidate
   workbook with an `AI Change Log` sheet; the accepted workbook is unchanged.
   Preview is required: it recalculates cached formulas, returns the inspection
   details and each cell's prior/proposed value or formula, and stores the
   candidate. Apply only after approval with
   `dcf model apply <proposal-id> --approve` (MCP `proposal_apply` with
   `approval: true`); apply re-validates the stored candidate — it never builds
   one inline — and preserves the prior revision's filing/route metadata on the
   new revision. Rejection leaves the accepted workbook unchanged. Run
   `dcf model export AAPL` afterward to create a dated copy.

5. Run `dcf model review AAPL` after the change and inspect the revision/hash
   before relying on the workbook.

A proposal carries the AI summary and each change's prior value or formula,
proposed value or formula, rationale, and filing accession; review-only
proposals also require a verification result. `dcf model preview` writes those
plus the validation result into the candidate's `AI Change Log` sheet. Free-form
ChatGPT conversation notes are still not exported as a separate report.

**Editing note:** formulas in Excel are editable. The library also detects
manual edits to `current.xlsx`; applying a proposal to a workbook whose hash has
changed is blocked. There is not yet a command to accept a manual edit as a
new library revision. Keep analyst experiments in a separate workbook copy
until that workflow is added. See [known issues](BUGS.md).

### Tool access from Codex or ChatGPT

The project exposes a local stdio MCP server through dcf mcp or:

```bash
npm --prefix model run dcf-mcp --silent
```

Configure its executable and absolute project paths in a local stdio-capable
MCP client. The server uses the same services as the CLI for model discovery,
workbook inspection, filing checks, revision listing and comparison, validation,
and sourced proposals. `proposal_preview` builds the validated candidate with
its `AI Change Log`; applying a proposal still requires explicit approval and
runs the same shared apply path. The MCP server does not trigger a full model
rebuild; run `dcf model update <ticker>` in the CLI first, then review the dated
workbook with ChatGPT.

For ChatGPT, the app connection needs either a reachable HTTPS MCP endpoint or
a supported Secure MCP Tunnel. DCF CLI currently provides the local stdio
server; it does not host or configure the tunnel for you. See OpenAI’s
[ChatGPT MCP quickstart](https://developers.openai.com/plugins/build/app-quickstart)
and [Secure MCP Tunnel guide](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

If you do not configure tool access, the file-upload workflow above still lets
ChatGPT inspect the workbook, but you run DCF CLI commands yourself.

## 🧪 Verification

```bash
npm run typecheck
npm run test:model
```

`test:model` uses live SEC/provider data and real workbook exports. It requires
network access, EDGAR_IDENTITY, Python dependencies, and LibreOffice. It
includes the main live model suite plus a live AAPL check for issuer filings
submitted through a filing agent when the current SEC response contains a
usable mixed filing sample; otherwise the check logs a clear skip. Live
providers can rate-limit or return stale data; model routes fail closed when
required context is missing.

The full live suite has **not** been re-run for the current working-tree
changes; it is pending the local LibreOffice `soffice` download. A green run
covers the named live routes and controls only; it does not establish universal
company or sector coverage.

## 📚 Project docs

- [Model coverage and route limits](docs/MODEL_COVERAGE.md)
- [Bugs and open workflow gaps](BUGS.md)
- [Model library, revisions, and proposals](docs/MODEL_LIBRARY.md)
- [API reference](API_DOCS.md)
- [CLI operations](OPERATIONS.md)
- [Project map](PROJECT_MAP.md)
