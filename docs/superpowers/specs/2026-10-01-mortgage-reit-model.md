# Agency Mortgage REIT Model

**Status:** Live SEC source audit supports AGNC as an implementation candidate (2026-10-01)

## Goal

Add a separate valuation for agency mortgage REITs driven by MBS asset yields, repo and other funding, swap/TBA hedging, leverage, common book value, and shareholder distributions. Mortgage REITs must remain separate from equity REIT AFFO/NAV and corporate FCFF DCF routes.

## Live source audit

AGNC's FY2025 Form 10-K (filed 2026-02-23, accession `0001423689-26-000043`) provides a three-year selected-financial-data table and dedicated portfolio/funding tables. The live filing reports, among other rows, FY2025/FY2024/FY2023 net interest income of $675 million/$18 million/($246) million; average investment-security yields of 4.90%/4.70%/4.11%; aggregate economic cost of funds of 2.98%/2.28%/1.05%; net interest spreads of 1.92%/2.42%/3.06%; average repo and other debt of $64.472 billion/$54.658 billion/$44.027 billion; and period-end repurchase agreements and other debt of $85.342 billion/$60.862 billion/$50.506 billion.

The same filing reports period-end investment securities, total assets, stockholders' equity, tangible/net book value per common share, diluted weighted-average shares, preferred dividends, common dividends per share, comprehensive income, and a leverage calculation. Asset yield and funding cost include non-GAAP TBA/swap adjustments; the model must preserve GAAP statements alongside those filed economic measures rather than combining their values as if they were the same accounting basis.

## Valuation method

- Forecast average invested assets and mortgage borrowings from editable leverage and equity-capital drivers.
- Forecast economic interest income using filed average asset yield; forecast borrowing cost and swap/TBA economics using separate editable rate assumptions. Show GAAP NII separately and reconcile the economic spread build to filed history.
- Forecast operating costs, preferred dividends, common earnings, distributions, and common book value per share. The book roll-forward separates retained earnings, dividends, and an explicit rate/spread mark-to-market assumption.
- Value common equity with a residual-income model: opening tangible common book value plus forecast and terminal residual income discounted at a current, dated cost of equity. Terminal growth must remain below cost of equity.
- Show price/tangible-book, dividend yield, leverage, asset yield, funding cost, and book-value-per-share checks as separate cross-checks. Do not produce a corporate enterprise-value/FCFF bridge for an agency mREIT.
- In the base case, the rate/spread mark-to-market book adjustment is an editable analyst input; rate shocks and spread widening remain separate sensitivities rather than being silently assumed away.

## Eligibility boundary

- Production model ID: `mortgage_reit_residual_income`.
- Initial candidate: AGNC's agency-heavy MBS/repo model. A mortgage REIT must have source-ready MBS asset balances, funding balances and cost, hedge/TBA treatment, common and preferred claims, period-end common shares/book, dividends, and current market inputs.
- Block commercial mortgage REITs, mortgage originators, mixed property REITs, and other mREIT strategies until their assets, credit losses, financing, and valuation method are mapped separately.

## Workbook

Create `Mortgage REIT Model` and `Data Review` sheets. Keep GAAP NII/net income, non-GAAP economic NII/spread, MBS/TBA assets, repo debt, swaps, leverage, preferred claims, common book value, distributions, editable assumptions, residual-income valuation, price/book and dividend checks, and sensitivities separately labeled. Forecast rows must use editable Excel formulas; Python supplies actuals and provenance only.

## Acceptance

- Live AGNC extraction matches FY2023–FY2025 values, units, scale, accessions, filing dates, and source table/statement labels.
- Economic interest income/expense, asset yield, cost of funds, net spread, leverage, common book value, preferred claims, common shares, and dividends reconcile to the issuer's disclosures.
- The five-year model reconciles average balances, spread income, funding cost, common equity and dividend schedules, residual income, and per-share value.
- Higher asset yield/leverage increase earnings and value within supported ranges; higher funding costs, hedging costs, mark-to-market losses, cost of equity, and dilution reduce common equity value.
- Recalculated formula workbook has no formula errors and matches engine common-equity value within 0.1% and per-share value within $0.01.
- A live agency mREIT exports only after source/engine/workbook verification; a commercial mortgage REIT remains blocked.
