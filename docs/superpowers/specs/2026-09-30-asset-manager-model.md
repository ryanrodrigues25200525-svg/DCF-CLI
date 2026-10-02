# Traditional Asset Manager AUM Model

**Status:** Authorized specialist-family work under the broad company-model coverage project.

## Goal

Add a separate valuation route for U.S.-listed traditional asset managers whose recurring investment-advisory revenue is driven by reported assets under management (AUM). Preserve a specific block for alternative managers whose carried interest, principal investments, and GP commitments require a different model.

## Live source audit

- BlackRock (BLK; SEC CIK 2012383, SIC 6211) and T. Rowe Price (TROW; CIK 1113169, SIC 6282) currently reach the unsupported `other_financial` classification instead of an asset-manager subtype. BX and KKR reach the same generic financial block.
- BLK's FY2025 Form 10-K (accession `0001193125-26-071966`, filed 2026-02-25) includes a five-year year-end AUM table and a three-year revenue table separating investment-advisory fees, securities lending, performance fees, technology subscriptions, distribution, and other revenue.
- TROW's FY2025 Form 10-K (accession `0001628280-26-008002`, filed 2026-02-13) reports year-end AUM and its annual change in readable text, plus investment-advisory and performance-fee disclosures. Its prior 10-Ks are needed to establish comparable annual AUM history; the latest AUM mix chart is not reliably represented as a numeric table in the current EDGAR text adapter.
- Standard SEC company facts provide consolidated statements but do not expose BLK AUM or the advisory-fee components as canonical XBRL facts. The product must parse them from filed 10-K text and retain the filing accession, filed date, reported period, unit, and extraction method.

## In scope

- Traditional asset managers with at least three consecutive filed AUM periods and source-backed recurring advisory-fee revenue, expenses, capital spending, cash, debt, diluted shares, and current market inputs.
- An AUM roll-forward with beginning AUM, market change, net flows, acquisition/FX changes where disclosed, and ending/average AUM.
- Separate forecast lines for base advisory fees, performance fees, securities-lending revenue, technology/subscription revenue, and other revenue when the filing reports them separately. A component that cannot be mapped remains missing or is shown as an editable analyst assumption; it is not silently set to zero.
- A five-year formula-driven FCFF valuation, enterprise-to-common-equity bridge, per-share value, and sensitivities. Source-backed facts, analyst assumptions, and any derived fee yield remain distinct.
- Initial live acceptance candidates: BLK and TROW. Support is enabled issuer-by-issuer only after the filing parser, engine, workbook, and live parity checks pass.

## Out of scope and fail-closed boundary

- Alternative investment managers such as BX and KKR remain blocked until the model separately handles fee-related earnings, realized and unrealized carried interest, principal investments, and GP commitments.
- Asset servicers, broker-dealers, banks, insurers, closed-end funds, and investment trusts use their own financial-company models; they do not inherit the AUM route from SIC alone.
- An issuer with fewer than three consecutive AUM/fee observations, unreadable filing tables, mixed asset-management and unrelated segments without a filed bridge, or an incomplete equity bridge receives a specific block and no workbook.
- A generic EV/EBITDA peer set is not sufficient evidence for this route. A terminal exit multiple is used only when a current, curated traditional-manager peer set is available; otherwise the model uses the source-ready Gordon-growth method and marks the peer cross-check unavailable.

## Calculation design

1. Forecast end AUM from beginning AUM plus the separate market-return, net-flow, and disclosed acquisition/FX drivers. Calculate average AUM as the average of beginning and ending balances.
2. Forecast base advisory revenue as average AUM multiplied by an editable base-fee yield initialized from filed advisory-fee revenue and average AUM. Forecast reported performance, technology, securities-lending, and other revenue lines separately.
3. Forecast operating expenses from disclosed history, calculate EBIT, cash taxes, D&A, capital expenditures, and change in operating working capital, and derive FCFF.
4. Discount FCFF at a dated WACC, calculate a sustainable Gordon-growth value and optional source-backed exit-multiple cross-check, then bridge enterprise value to common equity and diluted value per share.
5. Show reconciliation checks for the AUM roll-forward, fee revenue build, operating profit, FCFF, terminal assumptions, and enterprise-to-equity bridge. Check outputs remain informational and do not feed the valuation.

## Acceptance criteria

- BLK and TROW are classified as traditional asset managers rather than banks or generic operating companies; alternative-manager examples remain explicitly blocked.
- Each AUM and fee actual reconciles to a filed annual 10-K row/table and retains accession, filed date, fiscal year, unit, scale, and method.
- The live engine and recalculated workbook agree within 0.1% of common-equity value and $0.01 per share. No formula errors or broken references appear.
- Editing AUM growth, net flows, fee yield, operating margin, WACC, terminal growth, debt, and diluted shares moves valuation in the expected direction.
- The live-only suite covers one supported traditional manager and one source-incomplete/alternative manager block. No fixture-only test is added.
- The route remains blocked if the required filing-derived AUM or fee revenue schedule cannot be mapped.
