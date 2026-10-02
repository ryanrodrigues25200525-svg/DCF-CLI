import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/**
 * Static workbook checks that stay in TypeScript. Python (openpyxl/LibreOffice)
 * owns workbook parsing and export; this module only verifies the file exists,
 * is plausibly a .xlsx (ZIP container), and reports its hash for revision
 * tracking. No Excel parsing here.
 */

export interface WorkbookChecks {
  exists: boolean;
  sizeBytes: number;
  sha256: string;
  isZip: boolean;
}

export interface ReviewManifest {
  ticker?: string;
  route?: string;
  revisionHash?: string;
  [key: string]: unknown;
}

export interface ReviewFiling {
  accession: string;
  filedDate: string;
}

export interface ReviewProposalSummary {
  summary?: string;
  changeCount?: number;
  validationErrors?: string[];
  [key: string]: unknown;
}

/** Read a workbook path and report existence, size, hash, and ZIP magic. */
export function runStaticWorkbookChecks(workbookPath: string): WorkbookChecks {
  let data: Buffer;
  try {
    data = readFileSync(workbookPath);
  } catch {
    return { exists: false, sizeBytes: 0, sha256: '', isZip: false };
  }
  const sha256 = createHash('sha256').update(data).digest('hex');
  const isZip = data.length >= 2 && data[0] === 0x50 && data[1] === 0x4b;
  return { exists: true, sizeBytes: data.length, sha256, isZip };
}

function manifestLine(manifest: ReviewManifest | null | undefined): string {
  if (!manifest || typeof manifest !== 'object') return 'Manifest: unavailable.';
  const parts: string[] = [];
  if (typeof manifest.ticker === 'string') parts.push(`ticker ${manifest.ticker}`);
  if (typeof manifest.route === 'string') parts.push(`route ${manifest.route}`);
  if (typeof manifest.revisionHash === 'string') parts.push(`revision \`${manifest.revisionHash}\``);
  return parts.length > 0 ? `Manifest: ${parts.join(' · ')}.` : 'Manifest: present (no ticker/route summary).';
}

/** Render a markdown review report joining manifest, filing, checks, proposal. */
export function formatReviewReport(
  manifest: ReviewManifest | null | undefined,
  filing: ReviewFiling | null | undefined,
  checks: WorkbookChecks,
  proposal?: ReviewProposalSummary | null,
): string {
  const lines: string[] = [];
  lines.push('# Model review report');
  lines.push('');
  lines.push(manifestLine(manifest));
  lines.push('');
  lines.push('## Filing');
  lines.push('');
  lines.push(
    filing ? `- SEC accession ${filing.accession}, filed ${filing.filedDate}.` : '- No new filing queued.',
  );
  lines.push('');
  lines.push('## Workbook static checks');
  lines.push('');
  lines.push(`- Exists: ${checks.exists ? 'yes' : 'no'}`);
  lines.push(`- Size: ${checks.sizeBytes} bytes`);
  lines.push(`- SHA-256: ${checks.sha256 === '' ? 'n/a' : `\`${checks.sha256}\``}`);
  lines.push(`- ZIP header (PK): ${checks.isZip ? 'yes' : 'no'}`);
  lines.push('');
  lines.push('## Proposal');
  lines.push('');
  if (!proposal) {
    lines.push('- No proposal draft attached.');
  } else {
    if (typeof proposal.summary === 'string') lines.push(`- ${proposal.summary}`);
    if (typeof proposal.changeCount === 'number') lines.push(`- Changes: ${proposal.changeCount}`);
    const errors = Array.isArray(proposal.validationErrors) ? proposal.validationErrors : [];
    lines.push(errors.length === 0 ? '- Validation: no errors reported.' : `- Validation errors: ${errors.join('; ')}`);
  }
  lines.push('');
  lines.push('## Reviewer checklist');
  lines.push('');
  lines.push('- [ ] Accession/filed date match the queued filing.');
  lines.push('- [ ] Unit scale reviewed (no millions/billions mix-up).');
  lines.push('- [ ] Native formulas intact; no hardcoded valuation outputs.');
  lines.push('- [ ] Missing-input gates show no value while inputs fail.');
  lines.push('- [ ] Explicit approval recorded before any apply.');
  lines.push('');
  return lines.join('\n');
}
