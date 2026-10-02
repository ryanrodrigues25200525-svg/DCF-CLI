# Life-Insurance Distributable-Earnings DCF

**Status:** Implemented for MET and PRU; the 79-test live-only suite passed on 2026-10-02.

## Goal

Add a separate common-equity DCF for life insurers that values cash available to common shareholders after required statutory capital retention and legal-entity dividend limits. MET and PRU are the initial live cases. Missing source or capital assumptions remain editable inputs, and the workbook withholds valuation until the model is complete.

## Method decision

Use a distributable-earnings DCF. This follows the DCF Builder Pro objective and values direct equity cash flow rather than applying corporate FCFF/EV methods to an insurer. The design is source-disciplined: the segment earnings basis, capital retention, statutory upstream capacity, and parent-company bridge are visible. Missing inputs are not replaced with a guessed payout or RBC ratio.

## Live source contract

Both companies are U.S. life insurers with December 31 year-ends. Their 2025 Form 10-Ks are issuer-specific:

- **MET:** adjusted earnings available to common shareholders by segment, after tax. FY2023–FY2025 totals were $5.525B, $5.796B, and $5.943B. Segment values remain separate. Its filing reports statement-based combined RBC above 350% and NAIC-based combined RBC above 370% at year-end 2025; these are floors, not exact ratios. It also reports domestic subsidiary dividend limits/payments and a holding-company cash target.
- **PRU:** adjusted operating income before income taxes by segment. FY2023–FY2025 totals were $5.599B, $5.926B, and $6.637B. The model applies a blank, source-required normalized tax assumption before treating these amounts as common-equity earnings. PRU reports PICA statutory capital and surplus of $15.907B in 2025, statutory income of $1.951B, and a $1.848B 2026 ordinary-dividend capacity, while its 2025 filing describes RBC status relative to minimum/target levels without giving an exact consolidated ratio.

The metrics are not interchangeable. MET's disclosed adjusted earnings are already after tax; do not tax them again. PRU's operating-income measure is pre-tax. MET RBC floors and the PRU/PICA statutory-capital and dividend disclosures are scoped to specific capital groups, not consolidated cash available to all shareholders. Preserve the issuer, entity, jurisdiction, period, table label, units, accession, filing date, and source-text basis.

Sources: MET 2025 Form 10-K, accession `0001099219-26-000013`; PRU 2025 Form 10-K, accession `0001137774-26-000048`. A source audit is recorded in `Finance Knowledge Graph/Notes/2026-10-02 Life-insurer model source audit.md`.

## Forecast and valuation

1. **Historical earnings:** show three annual periods from the issuer's filed adjusted-earnings reconciliation. Keep all reported segments visible. Any closed-block, run-off, asset-management, or corporate lines not included in the adjusted measure must be reconciled or surfaced as an explicit uncovered-segment input.
2. **Five-year segment forecast:** build adjusted earnings from each segment's latest filed base and editable annual growth assumptions. For PRU, convert pre-tax adjusted operating income to after-tax earnings using a source-backed or clearly labeled analyst tax input. Do not present the result as company guidance.
3. **Capital and upstream distribution:** show all filed capital and dividend facts by legal entity/jurisdiction, but use one company-level aggregate net capital addition (positive retention; negative release) and permitted upstream dividend capacity per forecast year. Those aggregate assumptions must be blank, source-required inputs because MET and PRU disclose different subsidiary/jurisdiction scopes and do not publish a complete comparable parent-level capital-generation schedule. `Cash available before the upstream limit = after-tax adjusted earnings − net capital addition`. If this value is negative, retain the negative cash flow; otherwise `distributable earnings = MIN(cash available, permitted upstream dividend capacity)`. Each aggregate's source/rationale note must identify the material legal-entity and jurisdiction inputs used to build it.
4. **Common-equity DCF:** discount forecast distributable earnings at a dated CAPM cost of equity. Add a terminal value only when terminal-year distributable earnings are positive, terminal growth is below cost of equity by at least 50 basis points, and terminal growth is no greater than 10%. Add excess parent-company cash above an explicit reserve; subtract parent-company debt, preferred claims, and noncontrolling interests where applicable. Divide by a dated diluted share count. Do not show enterprise value or subtract operating insurance liabilities as corporate debt.
5. **Sensitivity:** show a 5×5 per-share sensitivity for cost of equity and terminal growth. The center must reconcile to the base case; invalid or incomplete cases show blank cells.

## Workbook and input behavior

- The model is available only for MET and PRU until another life insurer has its own live source adapter.
- Show `Life Insurance Model`, `Input Required`, and `Data Review` sheets. Keep filed earnings, company-defined adjustments, statutory facts, capital assumptions, and valuation formulas in separate sections.
- Inputs include segment growth, PRU tax conversion, target/minimum capital basis, company-level capital additions/releases, aggregate subsidiary dividend capacity, parent cash reserve, parent debt/claims when unmapped, terminal growth, and any missing source-reconciliation line. Every analyst assumption and external fact requires a source or rationale note.
- Inputs are blue and unlocked. Calculations use native Excel formulas with direct cell references and visible labels. All valuation, terminal, per-share, and sensitivity outputs stay blank if any required value, source, or model check is missing or invalid.
- If the SEC parser cannot source a usable earnings measure or enumerate a material segment/capital gap, remain unsupported with an actionable reason rather than creating a generic life-insurance DCF.

## Acceptance

- Live MET/PRU SEC mapping tests preserve the different earnings bases and filing provenance, including reported capital and permitted-dividend scope.
- MET and PRU route to `input_required` when required tax, capital-retention, upstream-distribution, or current-market inputs are missing; no valuation is displayed.
- LibreOffice recalculation of blank, invalid, and restored workbooks has no formula errors. A direct native formula edit changes the dependent per-share output.
- The base sensitivity cell matches the DCF output; lower capital-return capacity lowers value, higher retention reduces distributable earnings, and invalid terminal assumptions gate outputs.
- Restored workbook and TypeScript engine outputs reconcile within 0.1% of common-equity value and $0.01/share for the same assumptions.
- Other life insurers remain unsupported until their own source contracts pass.
