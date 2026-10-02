# DCF Builder Readiness and Incomplete Workbooks

**Status:** Approved by the user on 2026-10-01; implementation pending
**Parent design:** `docs/superpowers/specs/2026-09-30-broad-company-model-coverage-design.md`
**Date:** 2026-10-01

## Goal

Given a U.S. public-company ticker and available SEC and current-market data, route the issuer to a reusable model family and generate an Excel valuation workbook with traceable actuals, editable assumptions, and editable native formulas. When the model family exists but required data is missing, generate a fillable sector workbook and clearly withhold the valuation. Never use a generic fallback or invented input to make an output appear complete.

## Product scope and user decisions

- The current input remains a ticker. The CLI retrieves SEC filings and market data using the existing source stack; uploaded statements are outside this change.
- A user-selected blank-input workbook is the behavior for a recognized, implemented model family with missing required inputs.
- The product has three distinct outcomes:
  1. **Ready:** the model route exists and its required inputs are complete; calculate the valuation and export the workbook.
  2. **Input required:** the model route exists but one or more required inputs are missing or ambiguous; export the sector workbook with those inputs blank and editable, and leave valuation outputs blank until the user completes them.
  3. **Unsupported:** the issuer's model family is not implemented or its business type cannot be classified safely; do not export a valuation workbook and give a specific explanation.
- A bank, insurer, REIT, or other specialist must use its appropriate equity valuation method. The product must not force corporate FCFF DCF onto businesses whose funding, regulatory capital, or balance sheet is inseparable from operations.
- Existing model families and supported coverage are governed by the parent design. Passing one issuer never establishes coverage for every issuer in that family.
- The workbook remains an Excel deliverable. Users can edit blue input cells and native formula cells directly in Excel; an in-app formula editor is outside this change.

## Current gap

`ModelEligibility.supported_by_current_engine` currently conflates route implementation and source completeness. `runValuationJob` exits before payload construction when it is false, so the exporter only receives complete supported valuations. `Data Review` currently displays warnings and source notes but has no structured missing-input manifest. Model mappers generally require finite numbers and therefore cannot safely interpret an absent required input as zero or export a guarded incomplete schedule.

## Design

### Route and readiness contract

Represent route availability separately from valuation readiness. The backend classifier remains authoritative and emits a stable status (`ready`, `input_required`, or `unsupported`), the selected production model family when one exists, the existing field-level readiness results, and structured missing-input descriptions. A missing value is not a zero. `not_applicable`, unavailable, ambiguous, and analyst-entered are separate states.

The model-family registry is the source of truth for whether a calculation engine and workbook adapter exist. A route is not considered implemented merely because its identifier appears in a type union. The route registry and exporter registry must agree. Required fields and their source periods/units are defined by the family; issuer parsers populate available values and provenance.

### Data flow

1. The CLI fetches unified company data as it does today.
2. Python canonicalizes filed facts, preserves their SEC provenance, classifies the company, and returns route status plus input readiness.
3. TypeScript consumes the authoritative route. `ready` continues through the current calculation and export flow. `input_required` skips numeric valuation calculation and builds an incomplete workbook payload from the selected family and sourced values. `unsupported` stops with the classifier's reason.
4. The Python workbook adapter builds the model-specific sheets and a `Data Review` register. Missing required source fields map to blank, blue cells with a label, unit, period, and concise entry instructions. The register identifies the field, reason it is missing, current source/status, and the workbook cell to complete.
5. The CLI writes an incomplete workbook successfully and prints its path plus the required fields. It must never print an implied valuation for that workbook.

### Workbook behavior

- Historical facts retain their period, concept, source, accession, filing date, unit, and scale. Derived facts name their formula/method. Analyst entries remain visually separate from filed values.
- A missing value remains blank in the workbook. It is never silently coerced to `0`, a peer fallback, or an unexplained preset.
- Required input cells are unlocked/editable and use the established blue input style. Formula cells remain native Excel formulas and are not protected from editing.
- A visible model status says `INCOMPLETE — fill required inputs`. Until every model-required field is entered, dependent forecast, terminal value, equity value, and per-share outputs return blank rather than a guessed value or spreadsheet error. Filling the required inputs causes the formulas to recalculate normally.
- Inputs whose absence makes a model structurally invalid (for example, the sector model itself is not implemented) are not represented as a generic DCF shell. They remain `unsupported` with a clear CLI explanation and no workbook.
- Existing complete workbooks keep their calculation logic, presentation, and engine/workbook parity.

### Error handling and boundaries

- A live-source outage is distinguishable from a company whose filing omits a required metric. Cached facts retain their existing source date and quality label; if no usable source data is available, the CLI reports a retrieval error. A provider outage is not disguised as an analyst assumption.
- Ambiguous mappings remain `input_required` with a reason; they are not selected silently.
- If an incomplete payload cannot produce the selected family workbook, export fails with a model-specific error. It must not fall through to the generic DCF mapper.
- Unclassified, mixed, or unsupported subtypes remain blocked until a proper family is implemented.
- The status and input manifest are validated at the Python/TypeScript API boundary. Invalid combinations (such as `ready` with required missing inputs or `unsupported` with a valuation route) fail clearly.

## Acceptance criteria

- Backend and TypeScript contracts distinguish model-family availability from data readiness.
- A ready live issuer still receives its existing route, sourced workbook, editable assumptions/formulas, and matching valuation.
- A live-source incomplete case with a registered family exports a workbook. Missing required cells are truly blank; required fields and reasons are visible; no valuation is displayed; the CLI reports the workbook path and missing fields.
- After required input cells are filled, LibreOffice recalculation yields no formula errors, populates dependent schedules, and produces a valuation. No model formula needs a Python recalculation to become editable.
- An unsupported live subtype still writes no workbook and reports a specific reason.
- Existing representative live routes retain engine/workbook equity parity within 0.1% and per-share parity within $0.01, and key assumption edits move outputs in the expected direction.
- The live-only policy remains in force. No fixture-only tests are added. Incomplete-flow tests obtain live issuer data and exercise a real classified family with at least one missing-input condition.
- CLI documentation distinguishes supported complete models, fillable incomplete models, and unsupported businesses without implying universal coverage.

## Implementation sequence

1. Separate route registration from data readiness in the backend and API contract while retaining precise field-level readiness.
2. Add the incomplete model payload/status path to the CLI application job without invoking valuation engines on incomplete data.
3. Implement blank-input and formula-guard behavior for the shared operating DCF workbook, then prove the full ready/incomplete/unsupported flow with live-source checks.
4. Apply the same incomplete-input contract to every implemented specialist family; then implement and source-enable remaining intended archetypes through their own model specifications and acceptance checks.
5. Re-run live exports, formula recalculation, workbook inspection, type checks, backend syntax checks, and update product documentation.

## Scope exclusions

- Non-U.S. filing integrations and user-uploaded source files.
- A formula editor inside the CLI or a web UI; Excel formulas remain editable in the exported workbook.
- Valuation output for an unimplemented model family.
- Replacing sector-specific model methods with a universal FCFF formula.
