# DCF Model Review

Review local DCF workbooks and propose traceable, filed-data-only updates.
Never silently edit an accepted workbook: drafts are proposals; only
`dcf model apply <id> --approve` (or MCP `proposal_apply` with
`approval: true`) writes through the shared apply service.

Start read-only:

```bash
dcf model review <ticker>   # static checks + real xlsx inspection
dcf model inspect <ticker>  # manifest file + DB + hash verification
dcf filings sync <ticker>   # latest filing snapshot; workbook untouched
```

Assistant MCP equivalents: `filing_latest` (with `fetchedAt`/`ageHours`/`stale`),
`source_snapshot` (paged via `offset`/`maxChars`, follow `nextOffset` until
null to read the whole normalized snapshot), `workbook_read_cells` (live
cached values + formulas for chosen cells), `filings_sync` (refresh snapshot
through the shared service; never writes workbooks).

## 1. Source checks

- Confirm each fact cites the filed concept, SEC accession, filed date,
  currency, and unit scale.
- Accession/filed date must match the queued filing snapshot for the ticker.
  The endpoint CIK must equal the profile CIK. The accession prefix identifies
  the submitting account and can belong to a filing agent; verify issuer
  identity using the filing's SEC metadata. The current monitor still rejects
  differing accession prefixes, a known false-negative issue listed in the
  README. Independently check rejected company report filings before review.
- `source_snapshot` contains normalized facts and provenance, not the full
  filing narrative. For narrative claims, open the primary SEC document using
  its returned reference; if only CIK/accession are available, use the SEC
  archive index for that CIK and dashless accession. If the document cannot
  be retrieved, say that only the structured source snapshot was reviewed.
- Verify unit scale (millions vs billions) before accepting any number.
- Reject any value without `source` + `accession` — never invent data.
- Missing required inputs: the workbook must show no valuation, not a guess.

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

Draft with `dcf model propose-update <ticker> --change` (one flag per edit).
Each change is `sheet|cell|proposed|rationale|source[|accession]`.
Creation reads each targeted cell's current literal/formula from the accepted
workbook and stores it as `priorValue`/`priorFormula`; the preview shows
priors, and creation refuses stale bases or missing sheets/cells:

| Field | Requirement |
| --- | --- |
| `sheet` / `cell` | Target location; `cell` like `C12` |
| `proposed` | New value; leading `=` means an explicit formula edit; plain numbers stored as numbers |
| `rationale` | Why, referencing the filed concept |
| `source` | Filed source, e.g. `SEC accession 0000320187-25-0000XX` |
| `accession` | Bare accession of the same filing (defaults to latest snapshot) |

Validation rejects unsourced or malformed changes; nothing is written until approval.

## 4. Approval requirement

- Applying requires explicit approval: CLI `dcf model apply <id> --approve`
  (optionally `--by <name>`); MCP `proposal_apply` requires `approval: true`
  and runs the SAME shared apply service (copy, openpyxl edits, `soffice`
  recalculation, new-error/sheet gates, staged publish with rollback + audit).
  "Staged" is literal: same-directory temp + rename per file, rollback copies
  retained, no multi-file atomicity claimed.
- Rejection is status-only: `dcf model reject <id>` (or MCP `proposal_reject`);
  the workbook is unchanged.
- The watcher (`dcf watch check` / `dcf watch run`) only stores snapshots and
  update-ready flags; it never edits workbooks.
- Restoring means copying `revisions/<revId>.xlsx` back, never rewriting history.
