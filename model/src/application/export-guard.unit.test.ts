import { describe, expect, it } from 'vitest';
import {
  requireValuationAsOfDate,
  specialistModelWarnings,
} from '@/application/run-valuation-job.js';
import type { DcfExportPayload } from '@/services/exporters/excel/types';

describe('export correctness helpers (#55, #47)', () => {
  it('requires a dated valuation context instead of wall-clock dating sources', () => {
    expect(requireValuationAsOfDate({ valuation_context: { as_of_date: '2026-02-01' } } as never)).toBe('2026-02-01');
    expect(() => requireValuationAsOfDate({ valuation_context: { as_of_date: null } } as never))
      .toThrow(/dated valuation context/i);
    expect(() => requireValuationAsOfDate({ valuation_context: {} } as never))
      .toThrow(/dated valuation context/i);
  });

  it('surfaces specialist workbook warnings for every specialist model, not just asset managers', () => {
    const payload = { uiMeta: { warnings: ['bank capital note'] } } as unknown as DcfExportPayload;
    expect(specialistModelWarnings(payload, true)).toEqual(['bank capital note']);
    expect(specialistModelWarnings(payload, false)).toEqual([]);
    expect(specialistModelWarnings({} as DcfExportPayload, true)).toEqual([]);
  });
});
