# U.S. Wireless Telecom Operator Model

**Status:** Approved scope; live source audit supports an AT&T implementation candidate (2026-10-01)

## Goal

Add a dedicated, source-backed valuation for U.S. integrated telecom operators whose filings provide enough subscriber, churn, network-investment, and segment data to construct a readable forecast. The first supported route should be limited to operators that pass the same source and workbook acceptance checks; a telecom SIC or positive EBIT alone must not enable it.

## Live source audit

AT&T's FY2025 Form 10-K (filed 2026-02-09, accession `0000732717-26-000120`) reports FY2023–FY2025 Mobility, Business Wireline, Consumer Wireline, and Latin America revenues and operating income; three-year wireless subscriber/net-addition/churn measures; three-year broadband/fiber connections; filed depreciation and capital expenditures; and 2026 capital-investment guidance. Its FY2025 Mobility segment reports $89.482 billion revenue and $27.196 billion operating income; year-end wireless subscribers are 120.105 million, postpaid phone churn is 0.90% per month, and fiber broadband connections are 10.406 million. These values are source-audit observations, not assumptions embedded in the model.

Verizon's FY2025 Form 10-K (filed 2026-02-17, accession `0000732712-26-000007`) reports wireless connections, postpaid accounts, ARPA, broadband, and segment data. Its operating-statistic tables include different churn availability by segment and a Consumer/Business structure that does not match AT&T's. It may be enabled only if the canonical source contract reconciles its required customer churn and segment figures without borrowing AT&T metrics.

## Model method

- Forecast wireless subscribers from beginning customers, editable gross additions, and filed monthly churn; solve the customer roll-forward with average-period subscribers so churn and service revenue use consistent customer bases.
- Derive historical monthly service revenue per average wireless subscriber from filed segment service revenue and customer counts. Keep the derived metric labeled as an app calculation, not issuer guidance.
- Forecast broadband and fiber customers separately using filed net additions and average connections. Derive broadband service revenue per average connection from filed segment revenue where the filing population reconciles.
- Keep equipment, legacy wireline, enterprise, Latin America, and other segment revenue separate. Use filed segment revenue and operating income to initialize each schedule; where the filing does not provide a usable operational driver, expose a named editable analyst growth or margin assumption.
- Forecast EBIT, taxes, D&A, network capital expenditures, working-capital investment, FCFF, dated WACC, Gordon-growth terminal value, and a source-backed common-equity bridge.
- Preserve annual filing history and disclose that a FY2025 annual base does not include FY2026 quarterly changes or post-year-end acquired operations unless a later filing or explicit pro forma schedule is mapped.

## Eligibility boundary

- Production model ID: `telecom_subscriber_dcf`.
- Initial candidate: AT&T (`T`). Verizon (`VZ`) is a live comparability and source-readiness case, not automatically enabled.
- Require three consecutive years of wireless subscribers, net additions or gross additions, monthly churn, service revenue, segment operating income, broadband/fiber connections where separately material, CapEx, D&A, working capital, current market data, dated WACC inputs, and a common-equity bridge.
- Keep cable-only, satellite, tower, telecom equipment, mixed media, and source-incomplete telecom issuers blocked until their own economics and data are modeled.

## Workbook

Create `Telecom Model` and `Data Review` sheets. Actual operating measures and SEC source metadata remain separate from blue editable assumptions. Subscriber roll-forwards, ARPU, segment revenue, segment margins, FCFF, the valuation bridge, reconciliation checks, and WACC/terminal-growth sensitivities use readable Excel formulas. Do not write forecast values from Python.

## Acceptance

- Live AT&T extraction reconciles FY2023–FY2025 values, concepts, units, 10-K accession, filing date, and table labels to the current SEC filing.
- AT&T forecast identities reconcile customers, revenue, segment revenue, FCFF, and the common-equity bridge. Changes to additions, churn, ARPU, margins, network CapEx, WACC, terminal growth, debt, and diluted shares move outputs in the expected direction.
- Live Verizon either passes every required source gate and produces a dedicated formula workbook, or remains blocked before workbook creation with exact missing/ambiguous driver names.
- Recalculated workbook has no formula errors; engine/workbook common-equity value ties within 0.1% and per-share value within $0.01; the sensitivity center ties to the main per-share value.
- README and CLI architecture docs state exact supported scope, base period, data limits, and unsupported telecom types.
