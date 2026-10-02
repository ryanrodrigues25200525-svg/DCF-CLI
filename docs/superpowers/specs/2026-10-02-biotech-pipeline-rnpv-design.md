# Pipeline Biotechnology rNPV Workbook

**Status:** Implemented for MRNA as an input-required model; source-complete valuation remains unavailable (2026-10-02)

## Goal

Recognize a biotechnology issuer with an implemented pipeline model and generate a formula-driven workbook when clinical and commercial assumptions are missing. Keep the asset-by-asset risk-adjusted valuation blank until source-backed or explicitly labeled analyst inputs are completed.

## Initial live acceptance issuer

Moderna (MRNA) is the first live case. Its FY2025 Form 10-K reports three marketed products and identifies active development assets and trial stages, but it does not supply asset-level peak sales, launch forecasts, probabilities of technical/regulatory success, retained economics, or remaining development spend. Those absent values must be editable inputs; they are not inferred from the current share price, peers, or generic biotech averages.

The first parser is issuer-specific to MRNA's SEC pipeline narrative. Other biotech issuers remain unsupported until the source contract maps their programs and collaboration economics.

## Valuation method

Use a risk-adjusted unlevered DCF with a visible enterprise-to-common-equity bridge and two operating components:

1. **Commercial franchise DCF:** start from reported consolidated annual revenue, clearly label that the SEC feed does not split marketed-product revenue from collaboration and milestone revenue, and require editable annual revenue growth and post-tax FCFF margin. Discount at WACC built from dated CAPM inputs, debt cost, tax, and capital weights. Use a terminal growth assumption below WACC.
2. **Individually forecast pipeline rNPV:** for each active SEC-disclosed late-stage candidate, forecast sales from blank inputs for expected launch year, peak sales, years to peak, exclusivity period, post-exclusivity erosion, probability of success, retained economic interest, and post-tax FCFF margin. Risk-adjust the post-launch cash flows by the analyst-entered probability of success, discount them at WACC, and deduct the present value of remaining development costs entered for that program. The pipeline sheet shows 35 annual periods: launch can be entered through base year +10 and exclusivity through base year +25, leaving ten forecast years after the latest supported exclusivity year. No pipeline terminal value is assumed beyond that finite schedule.
3. **Other source-listed pipeline assets:** every SEC-listed early-stage, paused, or otherwise unmapped asset remains visible in a separate inventory with its SEC facts, partner, and source basis. Each requires an editable 0/1 inclusion input and analyst-entered present value with a source or rationale. Its included value is the native Excel formula `inclusion × analyst-entered rNPV`; excluding a paused candidate is explicit. A separate unmapped-pipeline input is reserved for programs outside the filing inventory.

Enterprise value equals commercial-franchise value plus individually forecast late-stage asset rNPV, included other source-listed asset rNPVs, and unmapped-pipeline rNPV. Common-equity value adds current cash and marketable securities and subtracts debt, preferred equity, and noncontrolling interest. Divide by a dated diluted share count. Keep commercial and pipeline FCFF on an unlevered basis so the debt bridge is applied exactly once.

## Source and input rules

- Program identifier, description, development stage/status, partner, and filing source are SEC facts. Preserve accession, filing date, reporting date, and the Item 1 narrative basis in the workbook.
- Launch timing, sales, probability, margin, partner share, remaining R&D value, franchise growth, and terminal growth are blank analyst inputs. Require a source or rationale note for each asset-level assumption; label any analyst judgment.
- Every non-late-stage or paused filing-list asset remains in the workbook with an explicit editable inclusion control and a source note. Do not silently omit it from total pipeline coverage.
- Product-level marketed revenue is not available from the current MRNA parser. The consolidated revenue base remains identified as reported company revenue and must not be described as product-level revenue.
- If the filing parser cannot identify the live asset list or a material partner/economic share, export an incomplete workbook only when the model can enumerate the missing assets; otherwise block with an actionable source-contract reason.

## Workbook behavior

- Show visible `Biotech Model`, `Pipeline Valuation`, `Input Required`, and `Data Review` tabs.
- Keep source-backed program identifiers and phase facts separate from analyst inputs.
- Use native Excel formulas for launch ramps, exclusive-life sales, post-LOE erosion, probability-weighted cash flows, included development-cost PV, commercial-franchise DCF, equity bridge, and a 5×5 WACC/terminal-growth sensitivity. Other-program rNPVs stay fixed across that sensitivity because their underlying cash-flow schedules are not reported or separately modeled.
- Mark user inputs blue and unlocked. No valuation, terminal value, per-share value, or sensitivity is shown while any required input or source reference is missing or invalid. Disclose the workbook currency and share-count scale.
- Formulas should make the probability, launch, revenue-ramp, partner-share, and cost relationships inspectable without requiring a Python rerun.

## Boundaries

- This first route supports MRNA's SEC-disclosed program map only. It does not establish coverage for all biotechnology companies.
- Analyst inputs can produce a modeled result, but the workbook must disclose which assets, market forecasts, and partner terms were not reported.
- Do not estimate probability-of-success, peak sales, launch year, or drug pricing from sector defaults.

## Acceptance

- Live MRNA SEC response includes source-dated pipeline assets; missing assumptions map to blank editable inputs and a `Data Review` source register.
- The live CLI succeeds with an incomplete workbook, `results: null`, and no implied valuation in its text output.
- LibreOffice recalculation shows blank values when inputs are missing or invalid, and no formula errors.
- Paused/early program inventory stays visible; scope inputs control included residual rNPV, and turning a modeled asset off also removes its development-cost PV.
- Restoring test assumptions in a copy populates the commercial DCF and pipeline rNPV; a direct formula edit changes its downstream equity/per-share output.
- Sensitivity center reconciles to the base per-share result, and lower/higher WACC and higher terminal growth move value in the expected directions.
- The workbook's returned equity value and per-share result reconcile with the TypeScript rNPV engine for the same entered assumptions. This is formula parity, not validation of analyst sales or success assumptions.
- MRNA remains clearly scoped as the only live-tested biotech issuer; all other unsupported issuers remain fail-closed.
