# Live example workbooks

Built **2026-10-03 (UTC)** with the production CLI from live SEC data, each
through the pending-candidate gate: `dcf build` staged the candidate, an agent
review was recorded (`model candidate-verify`), and a human approval promoted
it (`model accept --approve`) before `model export` wrote the file below.
Each workbook was recalculated with LibreOffice at staging (zero cached
formula errors or staging refused) and re-inspected after acceptance.

| File | Ticker | Route | Readiness | Source accession | Filed | Mapped period | Sheets / formulas | Cached errors |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `2026-10-03_AAPL_DCF.xlsx` | AAPL | `unlevered_dcf` | ready | `0000320193-25-000079` | 2025-10-31 | period_end=2025-09-27 | 9 / 1986 | none |
| `2026-10-03_JPM_DCF.xlsx` | JPM | `bank_residual_income` | ready | `0001628280-26-008131` | 2026-02-13 | period_end=2024-12-31 | 2 / 200 | none |
| `2026-10-03_XOM_DCF.xlsx` | XOM | `integrated_energy_dcf` | ready | `0000034088-26-000045` | 2026-02-18 | period_end=2024-12-31 | 2 / 263 | none |
| `2026-10-03_DUK_DCF.xlsx` | DUK | `utility_dcf` | **input_required** | `0001326160-26-000014` | 2026-02-26 | period_end=2022-12-31 | 3 / 126 | none |
| `2026-10-03_CAT_DCF.xlsx` | CAT | `ev_ebitda` | ready | `0000018230-26-000008` | 2026-02-13 | period_end=2021-12-31 | 2 / 28 | none |
| `2026-10-03_AIG_DCF.xlsx` | AIG | `insurance_pnc_residual_income` | ready | `0000005272-26-000023` | 2026-02-12 | period_end=2025-12-31 | 2 / 243 | none |
| `2026-10-03_PLD_DCF.xlsx` | PLD | `reit_affo` | ready | `0001193125-26-051453` | 2026-02-13 | period_end=2024-12-31 | 2 / 170 | none |
| `2026-10-03_AGNC_DCF.xlsx` | AGNC | `mortgage_reit_residual_income` | ready | `0001423689-26-000043` | 2026-02-23 | period_end=2023-12-31 | 2 / 206 | none |
| `2026-10-03_BLK_DCF.xlsx` | BLK | `asset_manager_aum_dcf` | ready | `0001193125-26-071966` | 2026-02-25 | period_end=2023-12-31 | 2 / 295 | none |
| `2026-10-03_T_DCF.xlsx` | T | `telecom_subscriber_dcf` | ready | `0000732717-26-000120` | 2026-02-09 | period_end=2025-12-31 | 2 / 438 | none |
| `2026-10-03_PFE_DCF.xlsx` | PFE | `mature_pharma_product_dcf` | ready | `0000078003-26-000026` | 2026-02-26 | period_end=2025-12-31 | 2 / 270 | none |
| `2026-10-03_MRNA_DCF.xlsx` | MRNA | `biotech_pipeline_rnpv` | **input_required** | `0001682852-26-000033` | 2026-02-20 | period_end=2023-12-31 | 4 / 1267 | none |
| `2026-10-03_MET_DCF.xlsx` | MET | `life_insurer_distributable_earnings_dcf` | **input_required** | `0001099219-26-000013` | 2026-02-19 | fiscal_year=2025 | 3 / 295 | none |

Route limitations observed at build time (not defects):

- **AAPL:** the model maps the 10-K fact source above. A newer 8-K/A
  (`0001140361-26-035325`, filed 2026-09-01) was detected and queued
  update-ready; the workbook is **not** updated with that filing's period.
- **DUK:** required regulatory inputs are missing, so the workbook reports
  `INCOMPLETE — fill required inputs` and withholds valuation. This is the
  intended missing-input gate, not a failure.
- **JPM / XOM:** specialist routes map annual actuals; a newly reported
  quarter is not automatically incorporated. Check
  [Model coverage](../docs/MODEL_COVERAGE.md) before assuming a refresh
  includes it.
- **DUK watch:** a newer 424B3 (`0001326160-26-000042`, filed 2026-09-28) was
  detected after staging and queued update-ready.
- **MRNA / MET:** required clinical/capital inputs are missing, so both
  workbooks report `INCOMPLETE — fill required inputs` and withhold valuation.
  This is the intended missing-input gate, not a failure.

No library database, manifest, snapshot, identity string, or user workbook is
stored here — only the four dated exports above.
