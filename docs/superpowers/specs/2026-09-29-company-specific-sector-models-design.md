# Company-Specific Sector Models

**Status:** Approved design; supported vertical slices implemented, utility model remains gated on source readiness (2026-09-30)

**Date:** 2026-09-29

## Purpose

Generate a separate, editable workbook for each issuer from a valuation model that matches the issuer's business economics. Reuse sector-level model engines and workbook conventions; do not maintain bespoke code paths for individual tickers. Company disclosures, segment mix, reporting basis, and available operating data must still shape each issuer's inputs and forecast.

The model must show where historical inputs came from, keep forecasts and valuation formulas inspectable in Excel, and refuse to produce a valuation when its model or required data is incomplete. A polished workbook or a successful export is not evidence that a model is investment-banking grade.

## User requirements and constraints

- The requested output is company-specific, with sector-specific forecasting and valuation logic.
- Workbook assumptions and formulas must be visible and editable; formulas must use clear labels and linked assumptions rather than opaque hardcoded calculations.
- Material historical figures must have source, period, unit, and filing-date traceability.
- Live SEC and market inputs must be used for validation. The user has asked that non-live tests remain removed, so this work will not restore them.
- Preserve the existing dirty worktree and unrelated user changes. Do not reset, stage, or commit changes.
- Do not claim coverage for sectors or company types that have not passed the model's acceptance checks.

## Current implementation

- The backend classifies operating companies, banks, insurers, REITs, utilities, high-growth companies, and distressed companies.
- The operating-company route retains the unlevered DCF for source-ready standard operating companies. AAPL passed live SEC/market sourcing and formula-workbook checks: filed EBIT/gross margin, CapEx, D&A, and days-based working-capital inputs are visible/editable; five forecast FCFF years tie to the engine; Artifact Tool recalculation reports no formula errors; enterprise/equity value ties to floating-point rounding and per-share value is within $0.01. This validates AAPL, not every operating sector.
- The commercial-bank route uses a dedicated residual-income engine and formula-driven `Bank Model` workbook. JPM and BAC have passed live source mapping, five-year forecast identities, CLI export, Artifact Tool recalculation, valuation parity, and key sensitivity direction checks.
- The bank workbook sources the minimum CET1 ratio from the issuer's 10-K and discloses its CET1 retained-earnings proxy. It does not separately forecast regulatory deductions, AOCI, or supervisory adjustments.
- AIG's P&C route uses filed General Insurance, reserve, and statutory-capital schedules, with a common-equity residual-income workbook. It discloses that statutory capital and parent distributions are proxies.
- PLD's equity-REIT route uses filed NAREIT/Core FFO reconciliation, same-store NOI, recurring-cost assumptions, an analyst AFFO DCF, and a property-only market-implied NAV cross-check. It discloses that AFFO adjustments are analyst-defined and NAV excludes Strategic Capital and other non-property items.
- Utility models remain blocked: DUK's current SEC feed lacks jurisdiction-level rate base and authorized-return inputs, and NEE is mixed regulated/unregulated.
- Passing JPM, BAC, AIG, or PLD does not establish universal coverage or investment-banking-grade suitability.

## Current live verification

- On 2026-09-30, the live-only CLI suite passed 22/22 tests. It covered the AAPL operating model, JPM/BAC banks, AIG P&C insurance, PLD equity REIT, and live blocks for unsupported subtypes including mortgage REITs, life insurance, utilities, and a high-growth issuer.
- A separate full run briefly lacked JPM's live risk-free-rate and equity-risk-premium inputs. The model stayed blocked; the bank mapping check now allows that result only when those exact inputs are the sole readiness gaps and the block reason names them. The focused retry and final full live-only run passed.
- AAPL's Artifact Tool recalculation checked the forecast formulas and edits to revenue growth, EBIT margin, gross margin, CapEx, and DSO. Each input moved its linked schedule as expected; the five forecast FCFF values matched the engine to floating-point precision, and the selected terminal-growth valuation matched equity value and per-share value before display rounding.
- TypeScript typecheck, Python syntax compilation, and `git diff --check` passed. The suite ran only `model/src/cli.live.test.ts`; non-live tests were not run.

## Proposed architecture

### 1. Shared issuer and source layer

Keep one shared company payload and workbook export contract. The backend canonical mapper is the sole authority for choosing SEC concepts and mapping reported periods to model fields; the TypeScript model consumes those canonical fields instead of independently selecting from raw statement rows. Preserve the original rows and their accession, filing date, fiscal period, currency, unit scale, and normalization notes for review. Distinguish reported facts, derived values, external market data, and analyst assumptions. Missing and ambiguous inputs remain explicit; they are not replaced with guessed values or silent plugs.

Company classification must include business subtype and model readiness, not just a broad sector label. If a company has materially different segments or a subtype that the selected engine does not support, return a block with a specific reason. Risk-free rates, equity risk premiums, beta, and other material market inputs must be dated and sourced; the app must not silently substitute static defaults for a valuation input.

### 2. Independent sector model engines

Each engine receives the shared issuer payload plus its required sector inputs and produces a forecast, valuation, workbook formulas, and model-specific checks. A shared interface may standardize inputs and outputs, but sector calculations must remain separate. The workbook for each issuer contains that issuer's reported history, assumptions, forecast, valuation bridge, sensitivities, source review, and checks.

Initial model families:

- **Commercial banks:** average loan and deposit balances, yields and funding costs, net interest income/margin, fees, credit provisions and losses, and regulatory capital. Value common equity using an equity method such as residual income or dividends; do not use corporate FCFF or enterprise-value DCF.
- **Property and casualty insurers:** written and earned premiums, retention and pricing, loss and expense ratios, reserve development, investment portfolio and yield, capital, and distributions. Keep life insurers and materially different insurance subtypes blocked until their own drivers and valuation are specified.
- **Equity REITs:** property or same-store revenue and NOI, occupancy and rent, lease rollover, acquisitions/development/dispositions, recurring capex, debt, FFO/AFFO, and NAV/cap-rate analysis. Mortgage REITs require a separate model.
- **Regulated utilities:** rate-base roll-forward, allowed returns, approved and pending capex, depreciation, regulatory lag, financing, earnings, and dividends. Block unregulated or mixed utilities when the regulated portion cannot be modeled distinctly.

Later sectors such as software, biotech, energy/commodities, asset managers, and conglomerates require their own model definitions. They do not inherit one of these four models merely because their classification is uncertain; unsupported types remain blocked or require an explicit sum-of-parts model.

### 3. Formula-first workbook

Keep the calculation chain visible: sourced actuals feed editable assumptions and schedules; schedules feed forecast statements and the sector valuation; independent checks inspect the output. Inputs use the workbook's established input styling, while calculated cells contain readable formulas that reference labeled assumption cells. Do not hide unsupported calculations in Python-generated values or workbook constants.

Each workbook must include the model date, fiscal periods, currency/units, model/subtype name, assumptions and sources, valuation bridge, sensitivity drivers, and a review area that records passed, failed, unavailable, and not-applicable checks.

### 4. Fail-closed eligibility

An engine is eligible only when both conditions hold:

1. The model for that company subtype is implemented and has passed its acceptance checks.
2. The issuer payload contains the required inputs with sufficient source and period coverage.

Otherwise, CLI execution returns a clear unsupported or incomplete-data reason and does not write a valuation workbook. Draft routes are not presented as supported valuations.

## Delivery sequence

1. **Readiness gate:** make eligibility reflect implemented models and required inputs; block the current draft sector routes until their vertical slices pass.
2. **Commercial-bank vertical slice:** implement one complete bank model through live data mapping, editable workbook formulas, valuation, checks, and CLI/export parity.
3. **P&C insurance, equity REIT, and regulated utility:** implement and validate each as a separate model project. Revisit subtype classification before enabling each route.
4. **Additional sectors:** add only when their operating drivers, valuation method, source coverage, and validation cases are defined.

This order uses the existing sector routes and live examples while keeping the work separable. Each later sector project should have its own reviewed model specification before implementation.

## Acceptance criteria for each model

- Historical lines reconcile to filed values for the selected live issuer(s), with sources, units, and periods visible.
- Required drivers are sourced or clearly labeled as analyst assumptions; missing required drivers block the model.
- Forecast logic is formula-based, editable, and traceable from operating drivers to valuation.
- Core accounting and sector-specific checks are visible. A failed check is not hidden by a balancing plug.
- Enterprise/equity valuation method, claims bridge, share count, terminal assumptions, and sensitivity formulas are internally consistent.
- Changing key assumptions moves valuation in expected directions; workbook and CLI equity value agree within 0.1%, and per-share value agrees within $0.01, before display rounding.
- Workbook formulas contain no broken references or calculation errors in the supported recalculation check.
- The live-only suite covers at least one representative issuer for the new model and one relevant edge case or subtype. Passing examples validate those examples; they do not imply universal sector coverage.

## Decisions for review

- “Separate models for separate companies” means one tailored workbook per issuer, generated by a reusable engine for the issuer's supported business model.
- The initial model families are commercial banks, P&C insurers, equity REITs, and regulated utilities when the model and source inputs pass readiness. Utilities and other subtypes remain blocked until their own model acceptance checks pass.
- The first implementation vertical slice is the commercial-bank model; other sector routes stay blocked until their own acceptance criteria pass.
- The plan preserves the live-only test policy and does not commit or stage the dirty worktree.
