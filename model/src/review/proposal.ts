import type { FilingInfo } from '../watch/watch-service';

/** One proposed workbook edit, fully sourced to a filed SEC fact. */
export interface ProposedChange {
  sheet: string;
  cell: string;
  priorValue?: number | string | boolean | null;
  priorFormula?: string | null;
  // An explicit null clears the cell to a true blank (distinct from an
  // absent proposedValue, which means no value edit was proposed).
  proposedValue?: number | string | boolean | null;
  proposedFormula?: string | null;
  rationale: string;
  source: string;
  accession: string;
}

/** A reviewable batch of proposed edits against one accepted revision. */
export interface ProposalDraft {
  ticker: string;
  baseRevisionHash: string;
  summary: string;
  changes: ProposedChange[];
  createdAt: string;
  /** AI verification result. Required (non-empty) when changes is empty. */
  verification?: string;
  /** Filing accession giving source context to a review-only (zero-edit) proposal. */
  accession?: string;
}

export interface FilingRef {
  accession: string;
  filedDate: string;
}

export interface ProposalFact {
  sheet: string;
  cell: string;
  priorValue?: number | string | null;
  proposedValue?: number | string | null;
  concept: string;
}

const TICKER_PATTERN = /^[A-Z0-9.-]{1,10}$/;
const CELL_PATTERN = /^[A-Z]{1,3}[1-9][0-9]{0,6}$/i;
const ACCESSION_PATTERN = /^\d{10}-\d{2}-\d{6}$/;

function hasProposal(change: ProposedChange): boolean {
  // An explicit null is a blank-clear edit, not a missing value.
  if (change.proposedValue !== undefined) return true;
  return typeof change.proposedFormula === 'string' && change.proposedFormula.startsWith('=') && change.proposedFormula.length >= 2;
}

/** Mirror of the MCP exactly-one rule: value XOR explicit (=, length>=2) formula. */
function proposalContentError(change: ProposedChange): string | null {
  const hasValue = change.proposedValue !== undefined;
  const hasFormula = typeof change.proposedFormula === 'string' && change.proposedFormula !== '';
  if (hasValue && hasFormula) return 'set exactly one of proposedValue/proposedFormula';
  // Formulas belong only in proposedFormula; a "="-prefixed proposedValue is
  // ambiguous about the intended cell type and would bypass the formula gate.
  if (typeof change.proposedValue === 'string' && change.proposedValue.startsWith('=')) {
    return 'proposedValue starts with "="; use proposedFormula for formula edits';
  }
  if (hasFormula && !(change.proposedFormula as string).startsWith('=')) {
    return 'proposedFormula must start with "="';
  }
  if (hasFormula && (change.proposedFormula as string).length < 2) return 'proposedFormula must not be bare "="';
  return null;
}

/**
 * Validate a proposal draft. Returns a list of error strings (empty = valid).
 * The source+accession requirement on every change is the no-invented-values
 * gate: a change without filed provenance is rejected.
 *
 * A review-only proposal (zero cell edits) is valid only with a non-empty AI
 * summary and a non-empty verification result; its filing accession, when
 * present, must still be a well-formed SEC accession.
 */
export function validateProposalDraft(draft: ProposalDraft): string[] {
  const errors: string[] = [];
  if (!draft || typeof draft !== 'object') return ['proposal draft is required.'];
  if (typeof draft.ticker !== 'string' || !TICKER_PATTERN.test(draft.ticker.trim().toUpperCase())) {
    errors.push('ticker must match /^[A-Z0-9.-]{1,10}$/.');
  }
  if (typeof draft.baseRevisionHash !== 'string' || draft.baseRevisionHash.trim() === '') {
    errors.push('baseRevisionHash is required.');
  }
  if (!Array.isArray(draft.changes)) {
    errors.push('changes must be an array.');
    return errors;
  }
  if (draft.changes.length === 0) {
    if (typeof draft.summary !== 'string' || draft.summary.trim() === '') {
      errors.push('review-only proposals need a non-empty AI summary.');
    }
    const verification = (draft as { verification?: unknown }).verification;
    if (typeof verification !== 'string' || verification.trim() === '') {
      errors.push('review-only proposals with no cell edits need a non-empty verification result.');
    }
    const accession = (draft as { accession?: unknown }).accession;
    if (accession !== undefined && (typeof accession !== 'string' || !ACCESSION_PATTERN.test(accession.trim()))) {
      errors.push('accession must be a filed SEC accession (NNNNNNNNNN-NN-NNNNNN).');
    }
    return errors;
  }
  draft.changes.forEach((change, index) => {
    const label = `changes[${index}]`;
    if (!change || typeof change !== 'object') {
      errors.push(`${label} must be an object.`);
      return;
    }
    if (typeof change.sheet !== 'string' || change.sheet.trim() === '') {
      errors.push(`${label}.sheet is required.`);
    }
    if (typeof change.cell !== 'string' || !CELL_PATTERN.test(change.cell.trim())) {
      errors.push(`${label}.cell must be a valid Excel address (e.g. C12).`);
    }
    if (typeof change.rationale !== 'string' || change.rationale.trim() === '') {
      errors.push(`${label}.rationale is required.`);
    }
    if (typeof change.source !== 'string' || change.source.trim() === '') {
      errors.push(`${label}.source is required; values must cite a filed source, never an estimate.`);
    }
    if (typeof change.accession !== 'string' || !ACCESSION_PATTERN.test(change.accession.trim())) {
      errors.push(`${label}.accession must be a filed SEC accession (NNNNNNNNNN-NN-NNNNNN).`);
    }
    if (!hasProposal(change)) {
      errors.push(`${label} needs proposedValue or an explicit proposedFormula starting with "=".`);
    }
    const contentError = proposalContentError(change);
    if (contentError) errors.push(`${label} ${contentError}.`);
  });
  return errors;
}

/**
 * Map normalized SEC facts onto proposal changes. Every change carries
 * `source` + `accession` so invented valuation numbers cannot pass validation.
 */
export function buildProposalFromFiling(
  ticker: string,
  baseHash: string,
  filing: FilingRef | FilingInfo,
  facts: ProposalFact[],
  rationalePrefix: string,
): ProposalDraft {
  const normalized = ticker.trim().toUpperCase();
  const prefix = rationalePrefix.trim() === '' ? 'Filed fact update' : rationalePrefix.trim();
  const changes: ProposedChange[] = facts.map((fact) => ({
    sheet: fact.sheet,
    cell: fact.cell,
    priorValue: fact.priorValue ?? null,
    proposedValue: fact.proposedValue ?? null,
    rationale: `${prefix}: ${fact.concept} (filed ${filing.filedDate}).`,
    source: `SEC accession ${filing.accession}`,
    accession: filing.accession,
  }));
  return {
    ticker: normalized,
    baseRevisionHash: baseHash,
    summary: `Update ${normalized} from SEC filing ${filing.accession} (${facts.length} input${facts.length === 1 ? '' : 's'}).`,
    changes,
    createdAt: new Date().toISOString(),
  };
}

function formatCellValue(value: number | string | boolean | null | undefined): string {
  if (value === undefined || value === null) return '—';
  return String(value);
}

/** Render a human-readable review sheet with a deterministic checklist. */
export function formatProposalMarkdown(draft: ProposalDraft): string {
  const lines: string[] = [];
  lines.push(`# Proposal review — ${draft.ticker}`);
  lines.push('');
  lines.push(`- Base revision: \`${draft.baseRevisionHash}\``);
  lines.push(`- Created: ${draft.createdAt}`);
  lines.push(`- Summary: ${draft.summary}`);
  if (typeof draft.verification === 'string' && draft.verification.trim() !== '') {
    lines.push(`- Verification: ${draft.verification}`);
  }
  if (typeof draft.accession === 'string' && draft.accession.trim() !== '') {
    lines.push(`- Filing accession: ${draft.accession}`);
  }
  lines.push('');
  lines.push('## Proposed changes');
  lines.push('');
  if (draft.changes.length === 0) {
    lines.push('No cell changes were recommended (review only).');
    lines.push('');
  } else {
    lines.push('| # | Sheet | Cell | Prior | Proposed | Rationale | Source | Accession |');
    lines.push('| - | ----- | ---- | ----- | -------- | --------- | ------ | --------- |');
    draft.changes.forEach((change, index) => {
      const prior = change.priorFormula ?? formatCellValue(change.priorValue);
      const proposed = change.proposedFormula
        ?? (change.proposedValue === null ? '(blank)' : formatCellValue(change.proposedValue));
      lines.push(
        `| ${index + 1} | ${change.sheet} | ${change.cell} | ${prior} | ${proposed} | ${change.rationale} | ${change.source} | ${change.accession} |`,
      );
    });
    lines.push('');
  }
  lines.push('## Validation checklist (all must pass before approval)');
  lines.push('');
  lines.push('- [ ] Source present: every change cites a filed SEC source with accession.');
  lines.push('- [ ] Formula preserved: no native Excel formula replaced by a hardcoded value.');
  lines.push('- [ ] Missing-input gate respected: no valuation shown while required inputs fail.');
  lines.push('- [ ] Approval required: apply only with explicit approval (proposal_apply approval=true / CLI --approve).');
  lines.push('');
  return lines.join('\n');
}
