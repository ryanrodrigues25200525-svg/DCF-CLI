# DCF Model Review

Review local DCF workbooks and propose traceable, filed-data-only updates.
Never silently edit an accepted workbook: drafts are proposals; only explicit
approval — `dcf model apply <id> --approve` (or MCP `proposal_apply` with
`approval: true`) — writes through the shared apply service. There is no
autonomous LLM in the Python/TypeScript engine: the ChatGPT/Codex agent invokes
the tools and reasons over their output. A workbook is "AI-reviewed" only when
an agent actually ran the review.

Start read-only:

```bash
dcf model review <ticker>   # static checks + real xlsx inspection
dcf model inspect <ticker>  # manifest file + DB + hash verification
dcf model compare <ticker>  # cells + source/model context vs prior revision
dcf filings sync <ticker>   # latest filing snapshot; workbook untouched
```

Assistant MCP equivalents: `revisions_list` (revision filing/event metadata),
`model_compare` (same data as the CLI compare), `filing_latest` (with
`fetchedAt`/`ageHours`/`stale`), `source_snapshot` (paged via
`offset`/`maxChars`, follow `nextOffset` until null to read the whole normalized
snapshot), `workbook_read_cells` (live cached values + formulas for chosen
cells), `filings_sync` (refresh snapshot through the shared service; never
writes workbooks).

## 0. What the review covers

Inspect the current accepted model and, when a prior revision exists, compare
against it. The review reads:

- the current workbook (`dcf model review`, `workbook_validate`,
  `workbook_read_cells`) and the deterministic checks it returns;
- the prior-revision comparison (`dcf model compare` / `model_compare`,
  `revisions_list`) — cell/formula changes plus route, readiness, mapped fact
  period, and latest detected filing;
- the stored source snapshot (`source_snapshot`), which carries normalized facts
  and per-fact lineage but not full filing narrative;
- the primary filing narrative when it can be retrieved (follow the
  `_latestFiling` primary-document reference, or CIK + accession through the SEC
  archive index). If no narrative is available, say so and review the structured
  snapshot only — never imply the narrative was read.

When the user explicitly requests a full model refresh, run `dcf model update
<ticker>` in the local CLI. It rebuilds and validates the model using the latest
data mapped by that route, creates a new accepted library revision, and writes
a date-and-ticker export. Review that dated workbook afterward and run
`dcf model compare <ticker>` to see what changed against the prior revision; do
not imply a route incorporated quarterly data unless its source contract
supports it.

## 1. Source checks

- Confirm each fact cites the filed concept, SEC accession, filed date,
  currency, and unit scale.
- Accession/filed date must match the queued filing snapshot for the ticker.
  The filings endpoint CIK must equal the profile CIK, and its ticker (when
  present) must match the requested company. Do not treat the accession prefix
  as the issuer CIK: it identifies the submitting account and may belong to a
  filing agent. The monitor selects report forms from the issuer-scoped filing
  list and excludes owner forms (3/4/5/144); confirm identity from the endpoint
  CIK/ticker and filing metadata, not from the prefix alone.
- `source_snapshot` contains normalized facts and provenance, not the full
  filing narrative. For narrative claims, open the primary SEC document using
  its returned reference; if only CIK/accession are available, use the SEC
  archive index for that CIK and dashless accession. If the document cannot
  be retrieved, say that only the structured source snapshot was reviewed.
- Verify unit scale (millions vs billions) before accepting any number.
- Reject any value without `source` + `accession` — never invent data.
- Missing required inputs: the workbook must show no valuation, not a guess.
- `dcf model compare` states whether the latest detected filing was actually
  mapped into the workbook. Do not describe an annual-only model as
  quarter-updated when the newer filing was not mapped.

## 2. Formula / tie-out review

- Workbooks use native Excel formulas. Confirm they are intact via the
  inspection counts (`dcf model review` reports sheet list, formula count,
  cached formula errors, Input Required status, Data Review rows).
- Flag any native formula replaced by a hardcoded value: valuation outputs
  must stay computed, never typed in.
- Confirm missing-input gates still blank the outputs they guard.
- A hash mismatch (`inspect`/`review` report it) means manual editing outside
  the library: stop, review the divergence, do not propose or apply.

## 3. Proposal format

Draft with `dcf model propose-update <ticker> --change` (one flag per edit),
or in MCP with `proposal_create`. Each change is
`sheet|cell|proposed|rationale|source[|accession]`. Creation reads each targeted
cell's current literal/formula from the accepted workbook and stores it as
`priorValue`/`priorFormula`; the markdown preview shows priors, and creation
refuses stale bases or missing sheets/cells:

| Field | Requirement |
| --- | --- |
| `sheet` / `cell` | Target location; `cell` like `C12` |
| `proposed` | New value; leading `=` means an explicit formula edit; numbers (including exponent notation) and `true`/`false` keep their type; `__BLANK__` clears the cell |
| `rationale` | Why, referencing the filed concept |
| `source` | Filed source, e.g. `SEC accession 0000320187-25-0000XX` |
| `accession` | Bare accession of the same filing (defaults to latest snapshot) |

A proposal also carries a concise AI `summary` and, for a review-only proposal
(no cell edits), a non-empty `verification` result and optional filing
`accession`. Record it with `--review-only --summary <text> --verification
<text>` (CLI) or `changes: []` plus `summary`/`verification` (MCP). Validation
rejects unsourced or malformed changes; nothing is written until approval.

## 4. Candidate preview

Preview a recorded proposal before requesting approval:

- CLI `dcf model preview <proposal-id>`; MCP `proposal_preview`.
- Builds a separate candidate copy under
  `companies/<TICKER>/proposals/<id>/candidate.xlsx`, adds an `AI Change Log`
  sheet (summary, verification, and each change's prior/proposed value or
  formula, rationale, source, accession, plus the validation result),
  recalculates cached formulas with LibreOffice, and refuses on any new cached
  formula error, lost sheet, or unverified cell.
- Returns the deterministic inspection details (sheet/formula counts and
  baseline-to-candidate deltas) plus each applied cell's prior/proposed literal
  or formula, so the candidate can be reviewed without opening the workbook.
- Read-only toward the accepted workbook: `current.xlsx`, `manifest.json`, and
  revisions are unchanged. Preview is repeatable, and a failed preview leaves a
  previous candidate intact.
- Review the candidate and its `AI Change Log`. Passing validation is not the
  same as a human decision.

## 5. Approval requirement

- Applying requires a mandatory preview and explicit approval: CLI
  `dcf model apply <id> --approve` (optionally `--by <name>`); MCP
  `proposal_apply` requires `approval: true` and runs the SAME shared apply
  service. Apply refuses when the proposal has no stored candidate — it never
  builds one inline. The stored candidate is re-validated before publishing
  (accepted workbook still at the preview base, draft unchanged, candidate
  path/hash and contents match, cached formula errors and sheet/formula counts
  re-checked, `AI Change Log` present, targeted cells re-inspected). The new
  revision preserves the prior revision's mapped fact period and filing/route
  metadata rather than inventing a period. Publication is staged:
  same-directory temp + rename per file, rollback copies retained, no
  multi-file atomicity claimed.
- Rejection is status-only: `dcf model reject <id>` (or MCP `proposal_reject`);
  the accepted workbook is unchanged.
- After a proposal is applied, `dcf model export <ticker>` writes a new dated
  copy of the accepted revision (`YYYY-MM-DD_<TICKER>_DCF.xlsx` under
  `~/Downloads`, UTC date; repeat exports add `_02`, `_03`, …) for upload or
  sharing.
- The watcher (`dcf watch check` / `dcf watch run`) only stores snapshots and
  update-ready flags; it never edits workbooks.
- Restoring means copying `revisions/<revId>.xlsx` back, never rewriting history.
