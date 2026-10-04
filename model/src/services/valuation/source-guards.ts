import type { CanonicalFinancialLine } from '@/core/types/native';

/** Structural shape shared by canonical lines and narrower mapper inputs. */
export interface FiledLineLike {
  value: number | null;
  source: string;
  sources: Array<{ accession: string | null; filed: string | null }>;
}

/** Require a filed or derived value with complete SEC accession lineage. */
export function requireFiledValue(
  line: FiledLineLike | CanonicalFinancialLine | undefined,
  name: string,
  year: number,
  context: string,
): number {
  if (!line || (line.source !== 'sec_native' && line.source !== 'derived')) {
    throw new Error(`FY${year} ${context} input ${name} is missing or ambiguous.`);
  }
  if (typeof line.value !== 'number' || !Number.isFinite(line.value)) {
    throw new Error(`FY${year} ${context} input ${name} has no finite filed value.`);
  }
  if (line.sources.length === 0 || line.sources.some((source) => !source.accession || !source.filed)) {
    throw new Error(`FY${year} ${context} input ${name} has incomplete filing provenance.`);
  }
  return line.value;
}

/** Median of finite values; with a guard label it fails closed on empty or non-finite input. */
export function median(values: number[], guard?: { label: string; name: string }): number {
  if (guard && (!values.length || values.some((value) => !Number.isFinite(value)))) {
    throw new Error(`${guard.label} ${guard.name} requires finite filed history.`);
  }
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}
