import type { FilingInfo } from './watch-service';

/**
 * Pure extraction of the latest filing identity from a unified SEC payload.
 * No I/O. Scans defensively: payloads vary by route, so every object node is
 * inspected for an accession-like string paired with a filed-date-like string
 * (covers data.canonical_financials.annual[*] sources, data.financials_native,
 * and data.source_metadata without depending on any single shape).
 */

const ACCESSION_PATTERN = /\d{10}-\d{2}-\d{6}/;
const DATE_PATTERN = /\d{4}-\d{2}-\d{2}/;
const ACCESSION_KEY = /accession/i;
const FILED_KEY = /filed|filing|acceptance/i;

interface Candidate {
  accession: string;
  filedDate: string;
}

function extractAccession(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(ACCESSION_PATTERN);
  return match ? match[0] : null;
}

function extractDate(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.match(DATE_PATTERN);
  if (!match) return null;
  const candidate = match[0];
  return Number.isNaN(Date.parse(candidate)) ? null : candidate;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function collectCandidates(node: unknown, into: Candidate[]): void {
  if (Array.isArray(node)) {
    for (const item of node) collectCandidates(item, into);
    return;
  }
  if (!isRecord(node)) return;

  let accession: string | null = null;
  let filedDate: string | null = null;
  let fallbackAccession: string | null = null;
  let fallbackDate: string | null = null;
  for (const [key, value] of Object.entries(node)) {
    if (typeof value === 'string') {
      const acc = extractAccession(value);
      if (acc !== null) {
        if (ACCESSION_KEY.test(key)) accession = accession ?? acc;
        fallbackAccession = fallbackAccession ?? acc;
      }
      const date = extractDate(value);
      if (date !== null) {
        if (FILED_KEY.test(key)) filedDate = filedDate ?? date;
        fallbackDate = fallbackDate ?? date;
      }
    }
  }
  accession = accession ?? fallbackAccession;
  filedDate = filedDate ?? fallbackDate;
  if (accession !== null && filedDate !== null) {
    into.push({ accession, filedDate });
  }
  for (const value of Object.values(node)) {
    if (typeof value === 'object' && value !== null) collectCandidates(value, into);
  }
}

/** Return the accession paired with the max filed date, or null if none found. */
export function extractFilingInfo(unified: unknown): FilingInfo | null {
  if (typeof unified !== 'object' || unified === null) return null;
  const candidates: Candidate[] = [];
  collectCandidates(unified, candidates);
  if (candidates.length === 0) return null;
  let latest = candidates[0];
  for (const candidate of candidates.slice(1)) {
    if (candidate.filedDate > latest.filedDate) latest = candidate;
  }
  return { accession: latest.accession, filedDate: latest.filedDate };
}

/** Identity comparison for two filing references (null-safe). */
export function filingsEqual(a: FilingInfo | null, b: FilingInfo | null): boolean {
  if (a === null || b === null) return a === b;
  return a.accession === b.accession && a.filedDate === b.filedDate;
}
