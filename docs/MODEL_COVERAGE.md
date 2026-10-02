# Model coverage

Coverage snapshot: **2 October 2026**. “Live-verified” means that the named
issuer’s source mapping and workbook route have passed the project’s live
checks. It does not mean every company or subtype in that sector is supported.

## Showcase routes

| Example | Model route | Current status | What the workbook demonstrates |
| --- | --- | --- | --- |
| AAPL, CRM, WMT | Unlevered FCFF DCF | Live-verified | Editable operating assumptions, forecast schedules, discounting, terminal value, and equity bridge |
| CAT | EV/EBITDA comparables | Live-verified | Peer screening, selected peer median, and enterprise-to-equity bridge |
| SNOW | EV/Revenue comparables | Live-verified | Revenue multiple valuation when the operating DCF inputs are incomplete |
| JPM, BAC | Bank residual income | Live-verified | Bank-specific earnings, capital, distributions, and common-equity valuation |
| AIG | P&C insurance residual income | Live-verified | General Insurance separated from Other Operations |
| PLD | Equity REIT AFFO + NAV | Live-verified | AFFO forecast and property NAV with explicit corporate-item exclusions |
| AGNC | Agency mortgage REIT residual income | Live-verified | GAAP interest and economic funding kept separate; common-equity book-value bridge |
| BLK, TROW | Asset-manager AUM DCF | Live-verified | AUM roll-forward and fee-component revenue reconciliation |
| T | Telecom subscriber DCF | Live-verified | Subscriber, churn, broadband, segment revenue, and capital schedules |
| XOM | Integrated-energy DCF | Live-verified | Production, realized prices, unit costs, reserves, segment earnings, and cash CapEx |
| PFE | Mature-pharma product DCF | Live-verified | Product-level forecast with editable pre- and post-loss-of-exclusivity assumptions |
| MRNA | Biotech pipeline rNPV | Input-required | Asset-level launch, ramp, probability of success, retained share, and cost inputs; no value until required inputs are completed |
| MET, PRU | Life-insurer distributable earnings | Input-required | Issuer-specific segment earnings and a blank, source-required common-equity forecast |
| DUK | Regulated-utility DCF | Input-required | Blank source-required rate base, allowed return, equity ratio, additions, and depreciation |
| TGT | EV/EBITDA comparables | Input-required | Fallback peers are disclosed but not used to produce a multiple valuation |
| NVDA | EV/EBITDA comparables | Incomplete | Route is recognized, but the common-equity bridge is incomplete |
| VZ | Telecom | Input-required | Missing subscriber and segment data prevent a valuation |
| GS, NEE, STWD, CVX, MRK | Specialist routes | Blocked | These issuer/subtype combinations do not yet meet a supported source contract |

The first six complete examples make a useful public demo set: **AAPL, JPM,
AIG, PLD, AGNC, and XOM**. MRNA or DUK shows the fail-closed behavior for a
recognized company whose necessary inputs are not available. Generate current
workbooks locally with `dcf build <ticker>`; the repository contains the
editable model engines and exporters, not stale company-data snapshots.

## Important model boundaries

- **Commercial banks:** JPM and BAC project CET1 as opening CET1 plus net
  income less common distributions. Regulatory deductions, AOCI, and
  supervisory adjustments are not forecast separately. The filed minimum
  CET1 ratio is an editable base input; users should verify current buffers.
- **PLD:** AFFO is modeled as Core FFO less tenant improvements, leasing
  commissions, and all reported property improvements treated as recurring.
  The NAV cap rate starts at the current market-implied rate; Strategic Capital
  and other corporate/non-property items are excluded.
- **AGNC:** Values common equity from tangible book value plus residual income;
  it does not calculate enterprise value. The workbook separates GAAP interest
  from TBA/swap economic funding and models swap hedge coverage and net pay
  rate explicitly.
- **BLK and TROW:** The live route starts with FY2025 filed annual actuals.
  FY2026 quarterly AUM and fee changes are not incorporated.
- **AT&T:** The validated telecom model uses FY2025 as its operating base.
  FY2026 quarterly changes and later acquisitions or spectrum transactions are
  not included. VZ remains input-required without the dedicated telecom
  forecast schedule.
- **XOM:** The validated integrated-energy route uses FY2025 as its latest
  annual base. Later quarterly activity is not included. CVX, independent
  E&Ps, miners, and other energy subtypes remain blocked pending their own
  source contracts.
- **PFE:** The mature-pharma route models product sales and patent/LOE
  assumptions; pipeline NAV is excluded. FY2025 is the latest annual base.
  MRNA is an MRNA-specific pipeline source contract: commercial and clinical
  assumptions remain blank and source-required until an analyst fills them.
- **MET and PRU:** The life-insurer route is input-required. Statutory-capital
  and dividend disclosures keep their legal-entity scope; capital
  additions/releases, upstream capacity, and parent-company adjustments are
  not guessed.
- **Utilities and investment managers:** DUK’s jurisdiction-level regulatory
  facts are not mapped, so its model waits for sourced inputs. NEE remains
  blocked until regulated and unregulated operations can be separated.
  IVZ’s base-fee/AUM history is not mapped; BX/KKR need separate
  carry/principal-investment schedules.

Source fallbacks, stale data, unsupported peers, and mapping warnings are
reported in the CLI and the workbook’s `Data Review` sheet. A model route is
only used when its required sources and valuation bridges pass their gates.
