# Broad U.S. Public-Company Model Coverage

**Status:** Scoped multi-sector implementation passed the live-only suite (66/66, 2026-10-01); accepted support is issuer-specific and unsupported subtypes remain blocked.

**Parent design:** `docs/superpowers/specs/2026-09-29-company-specific-sector-models-design.md`

## Goal

Expand valuation coverage across U.S.-listed companies while refusing to route a company through a model that does not fit its economics or lacks its required source data. The CLI should generate a separate, formula-driven workbook for every eligible issuer using a reusable model family, not a ticker-specific code path.

## Requirements

- Use the existing SEC and current-market source stack for U.S. public issuers. Global and private-company ingestion is outside this expansion.
- Only production model routes appear as allowed. An unsupported or source-incomplete issuer receives a specific block and no valuation workbook.
- Preserve provenance for reported values and distinguish derived values, market data, and analyst assumptions.
- Forecast formulas reference labeled editable assumptions. Do not paste forecasts as values or insert unexplained template defaults.
- Preserve the live-only testing policy. Do not add or run fixture-only tests.
- Preserve the user's existing dirty checkout. Do not reset, stage, commit, install development tools, or discard existing work.

## Audit findings

- `classify_company` treats almost every positive-EBIT company outside the current bank, insurance, REIT, and utility branches as eligible for generic DCF.
- The eligibility response includes `ev_ebitda` and `revenue_multiple` among allowed models even though the workbook exporter rejects them as unimplemented.
- Unknown industries fall back to technology-hardware assumptions; known industry presets also replace some historical growth inputs with fixed template rates.
- Draft residual-income and utility-dividend calculation/export routes remain in the code even though the CLI correctly blocks those issuer types.
- The shared SEC payload provides income statements, balance sheets, cash flow statements, and selected company facts. It does not provide complete segment, backlog, subscription, store, commodity-production, pipeline, or utility regulatory data for every issuer.

## Architecture

### Explicit model registry and archetype

Keep backend eligibility authoritative. An operating-company result includes an explicit `operating_archetype`; the valuation router and exporter receive that exact value and select only registered production routes. `allowed_models` is derived from implemented calculation and workbook adapters, not from a list of aspirational model identifiers.

The first operating cohort is standard technology/hardware, subscription software, consumer/retail, industrial/manufacturing, and semiconductors. Source-ready issuers use a five-year unlevered DCF with editable archetype profiles; subscription software can use a filed aggregate working-capital residual when trade payables or inventory are not separately disclosed. If the DCF is not source-ready, a company can use a separate EV/EBITDA or EV/Revenue trading-comparables model only when its denominator, current peer set, and equity bridge pass their own checks. A company whose economics or source inputs remain unknown stays blocked.

### Formula-driven operating models

Filed history initializes the forecast. Where filings provide segment revenue or operating metrics, the model uses those values with period and source traceability. Where a future input is judgmental or an issuer does not disclose it, the workbook shows an editable, clearly labeled analyst assumption. The model must not present a sector preset as a company-specific estimate.

The common DCF uses dated market inputs, a source-supported capital bridge, a visible forecast, and a readable enterprise-to-equity bridge. The peer-multiple workbook shows the target denominator, live peer calculations and median formula, optional editable multiple override, sensitivity formulas, and the same source-backed equity bridge.

### Peer-multiple models

EV/EBITDA and EV/Revenue are separate production routes. Each requires a positive, source-backed denominator and at least three current, comparable, source-ready peers. The workbook shows peer selection, median multiple, net debt/claims bridge, share count, and editable assumptions. A peer multiple is not a substitute for a biotech pipeline model or a specialist financial-company method.

### Specialist families and boundaries

Keep each specialist on a separate calculation and workbook route. Accepted examples now include traditional asset managers BLK/TROW, U.S. wireless T, agency mREIT AGNC, integrated energy XOM, mature pharma PFE, and an input-required pipeline rNPV workbook for MRNA. These are first issuer contracts; VZ, STWD, CVX, MRK, independent E&Ps, miners, other pharma issuers, and mixed businesses remain blocked until their own sources and formulas pass acceptance. Life insurers MET/PRU and regulated utilities SO/NEE stay blocked because current filings lack required statutory-capital or segment/rate-case inputs; DUK receives an input-required rate-base DDM. No specialist inherits the generic DCF solely because it has positive EBIT.

## Phases

1. **Repair routing and defaults.** Block positive-EBIT specialist subtypes, remove unsupported allowed-model claims and draft export routes, and eliminate the unknown-industry technology-hardware fallback.
2. **Expand core operating archetypes.** Add explicit source-aware classifications and driver schedules for technology/hardware, software, consumer/retail, industrials, and semiconductors. Live DCF examples are AAPL, CRM, and WMT. CAT uses EV/EBITDA; SNOW uses EV/Revenue. NVDA remains blocked because the latest filing did not provide a complete CapEx and current marketable-securities bridge.
3. **Enable peer-multiple valuation.** Implement EV/EBITDA and EV/Revenue with live peer readiness and formula-based valuation bridges. CAT and SNOW pass live exports; TGT remains blocked when only fallback peers are available.
4. **Build specialist families.** Write and execute separate model specifications for energy/materials, telecom, mature and pipeline pharma, life insurance, asset management, mortgage REITs, and regulated utilities. Add a family only when the needed live data source is available and its acceptance checks pass.

## Acceptance checks

- Each enabled issuer archetype maps to exactly one supported model family; unsupported types remain blocked with a specific reason.
- Live SEC mapping checks reconcile periods, values, units, source concepts, accessions, and filed dates.
- Key assumptions are visibly editable and formula-linked from driver schedules through valuation.
- Recalculate representative live workbooks with LibreOfficeDev and inspect rendered pages and editable formulas. AAPL, CRM, WMT, CAT, SNOW, AGNC, XOM, and PFE live checks verify no formula errors, engine/workbook equity parity within 0.1%, per-share parity within $0.01, and key assumptions moving outputs in the expected direction. Artifact Tool is not available in the active tool set for the last two new models.
- With three filed historical years, leave unused timeline periods blank and keep the engine's five forecast years in the final five workbook columns.
- Engine/workbook equity value ties within 0.1% and per-share value within $0.01 before display rounding.
- The live-only CLI suite includes a representative issuer and a relevant unsupported subtype for each enabled family.
- README and CLI architecture docs state tested coverage and remaining limits without implying universal coverage.

## Execution rulings

- **Ruling:** Work on the core operating archetypes first because the user asked for broad coverage and did not select a narrower cohort; energy and biotech remain later specialist phases. Cost if wrong: those specialist models wait behind common operating coverage.
- **Ruling:** Treat the target as U.S.-listed SEC issuers because that is the current CLI source architecture. Cost if wrong: non-U.S. issuers remain unsupported until a filing-source integration is added.
- **Ruling:** Work in the existing checkout, preserve all pre-existing files, and do not stage or commit. The current worktree contains user changes, and a new Git worktree would omit them.
