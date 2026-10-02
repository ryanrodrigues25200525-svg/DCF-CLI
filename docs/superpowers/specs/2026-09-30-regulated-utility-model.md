# Regulated Utility Model

**Status:** Utility valuation remains input-required after live SEC source audit (updated 2026-10-02)

**Date:** 2026-09-30

## Goal

Build a separate rate-base and common-equity model for pure regulated electric, gas, and water utilities. Mixed or materially unregulated holding companies remain blocked unless regulated and nonregulated segments can be modeled separately with filed drivers.

## Model design

- Keep SEC concept mapping canonical and source-traceable. Map regulated rate base, allowed ROE, authorized equity ratio/capital structure, approved and pending capex, depreciation, regulatory assets/liabilities, earned return, debt, dividends, and diluted shares from issuer and regulatory disclosures.
- Forecast rate base as opening rate base plus approved/forecast additions less depreciation, disposals, and retirements. Tie earnings to rate base and authorized ROE/equity ratio rather than using consolidated revenue growth as the primary driver.
- Forecast regulatory revenue recovery, operating costs, depreciation, taxes, debt funding, interest expense, common net income, and dividends. Model regulatory lag as an explicit assumption or dated filing fact; do not bury unrecovered capex in a balancing plug.
- Use a common-equity valuation method appropriate to a regulated utility (dividend discount or a rate-base earnings valuation) with live, dated cost-of-equity inputs. Enterprise value is not produced unless a separate, internally consistent enterprise cash-flow bridge is explicitly implemented.
- Distinguish the regulated utility operating company from parent generation, merchant, renewable, pipeline, or other unregulated subsidiaries.

## Eligibility boundary

- DUK is the first pure-regulated-company candidate for live source review; SO is an alternate if DUK's segment history does not support the required schedules.
- NEE remains blocked unless its regulated FPL segment and unregulated Energy Resources segment can be separated from filings and separately valued.
- Require source-complete rate-base/capex/capital inputs and current dated price, share count, beta, risk-free rate, and ERP. Default, stale, unavailable, missing, or ambiguous required values block valuation.

## Workbook requirements

Create a `Utility Model` sheet and a `Data Review` sheet. Display reported rate base, capital structure, allowed returns, capex, depreciation, regulatory lag, and source references. Forecast rate base, earnings, debt and interest, common equity, dividends, and valuation through readable formulas. Inputs are blue/editable; any analyst rate-base or regulatory-lag estimates have source/date notes.

Checks must cover the rate-base roll-forward, allowed return, funding/debt roll-forward, dividend capacity, and equity valuation. The model must disclose parent/subsidiary and regulated/unregulated scope.

## Acceptance

- Live DUK (or documented alternate SO) actuals reconcile to current SEC and regulatory filings with accession/date/unit provenance.
- A live mixed/unregulated NEE case blocks unless separately modeled segment histories and capital flows are available.
- Rate-base, debt/financing, earnings, dividend, and per-share calculations reconcile; missing required rate-case inputs do not become zero.
- Higher approved rate-base growth/allowed returns increase equity value; higher regulatory lag, funding cost, or cost of equity reduces value.
- The formula workbook recalculates without errors and matches the engine within 0.1% equity value and $0.01 per share.
- Live utility calculation/export, a live NEE/mixed-subtype block, and workbook formula inspections are in the live-only suite. Passing one issuer does not imply support for all utilities.

## Current implementation boundary

The latest DUK 10-K and Southern Company alternate were inspected live. The current SEC source feed does not provide a complete jurisdiction-level rate base, authorized ROE, and allowed equity-ratio history for either issuer, so neither has a source-ready utility valuation. DUK has an input-required rate-base DDM workbook under the approved missing-input behavior. NEE remains unsupported because regulated FPL and unregulated Energy Resources operations are not separated. Consolidated PP&E and achieved ROE are not used as substitutes.

## Approved missing-input behavior

For a recognized pure regulated utility, the registered `utility_dcf` route now produces an input-required rate-base and dividend DCF workbook when regulatory facts are absent. The workbook leaves source facts and forward regulatory inputs blank, requires source references for reported rate-base and allowed-return facts, and withholds common-equity and per-share value until its status formula is `READY`. It does not infer regulatory values from consolidated PP&E, earned ROE, or generic growth rates. The current source gap remains visible, so the workbook is not treated as a source-complete live valuation.

The five-year model uses closing rate base plus sourced or explicitly supported additions less depreciation/retirements. Average rate base, authorized equity ratio, and allowed ROE drive allowed equity earnings; an editable payout ratio converts those earnings to dividends. A direct equity DDM discounts dividends using current dated CAPM inputs and terminal growth below cost of equity. The workbook shows the rate-base roll-forward, assumptions, source register, formula checks, and cost-of-equity/terminal-growth sensitivity. It does not produce enterprise value or corporate FCFF. Mixed regulated/unregulated NEE remains unsupported until its businesses can be separately valued.

Any later change that enables a source-complete `ready` utility calculation still requires live source mapping, engine/workbook parity, formula-error, and sensitivity acceptance before that status is enabled.
