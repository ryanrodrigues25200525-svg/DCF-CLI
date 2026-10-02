# Equity REIT Model

**Status:** Implemented and live-validated for PLD's industrial equity REIT scope (2026-09-30)

**Date:** 2026-09-30

## Goal

Replace the generic REIT draft with a separate property cash-flow, FFO/AFFO, and NAV model for source-ready equity REITs. Mortgage REITs and other real-estate financial businesses remain blocked.

## Model design

- Keep canonical SEC concept selection in the backend. Preserve GAAP net income, real-estate depreciation/amortization, property-sale gains/losses, recurring capital expenditures, leasing commissions, tenant improvements, common distributions, property counts, debt, cash, common equity, and diluted shares with filing provenance.
- Map same-store/property revenue and NOI, occupancy, rent/lease rollover, acquisitions/development/dispositions, joint-venture ownership, and segment mix only from company disclosures. Gross consolidated figures and the REIT's common-shareholder economic share must be distinguished.
- Calculate Nareit FFO from GAAP net income using the issuer-supported definition. Preserve the filed reconciliation. Present issuer-defined/core FFO separately. AFFO is explicitly an issuer/analyst-defined measure; it is not treated as standardized or comparable until each adjustment is reviewed.
- Forecast property revenue/NOI from editable property drivers where disclosed; model recurring maintenance capex and leasing costs separately from development/growth capex. Keep development, property sales, joint ventures, and funding requirements visible.
- Value common equity using an AFFO-based per-share method with NAV/cap-rate analysis as a separate cross-check. NAV starts from property-level or segment-level NOI/cap-rate assumptions and explicitly subtracts debt, preferred claims, and noncontrolling interests. Do not use corporate FCFF as the operating forecast.

## Eligibility boundary

- Support equity/property REITs only after FFO/AFFO and property/segment history are source-complete. Mortgage REITs are blocked for this model.
- PLD is the first live example. Classification must reject mortgage REITs and issuers without a usable property/NOI or FFO bridge.
- Require dated market inputs and current source lineage for share count, price, beta, risk-free rate, and ERP. Missing, ambiguous, default, or stale required inputs block valuation.

## Workbook requirements

Create a `REIT Model` sheet and a `Data Review` sheet. Show GAAP-to-FFO reconciliation, issuer AFFO reconciliation, property/NOI drivers, recurring versus growth capex, ownership share, debt/capital schedule, AFFO and NAV formulas, common-equity bridge, per-share outputs, and formula sensitivities. Assumptions are blue/editable; forecasts and valuations are formulas linked to labeled input cells.

Data Review must disclose each AFFO adjustment, cap-rate source/assumption, joint-venture ownership treatment, per-share dilution basis, and non-GAAP reconciliation. Do not label aggregate FFO growth as common-shareholder growth without per-share reconciliation.

## Acceptance

- Live PLD actuals match its filed statements and FFO/AFFO reconciliations with source metadata and unit normalization.
- Mortgage REITs block; missing property/FFO/NAV components do not become zero or guessed values.
- FFO, AFFO, distributions, NAV bridge, and common per-share value reconcile from formulas.
- Higher same-store NOI growth increases equity value; higher recurring capex, cap rate, or cost of equity reduces value.
- The formula workbook recalculates without formula errors and matches the engine within 0.1% equity value and $0.01 per share.
- Live PLD export and a live mortgage-REIT block are tested. This does not imply universal REIT coverage.
