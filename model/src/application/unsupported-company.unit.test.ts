import { describe, expect, it } from 'vitest';
import type { BackendPort } from '@/api/backend-client';
import { parseDcfExportPayload } from '@/api/contracts';
import type { NativeUnifiedPayload } from '@/core/types/native';
import type { DcfWorkbookPayload } from '@/services/exporters/excel/types';
import { formatValuationJobSuccess, runValuationJob } from '@/application/run-valuation-job.js';
import { biotechPayload } from '@/services/valuation/specialist-test-fixtures.js';

const REASON = 'Investment-bank valuation is unsupported: the commercial-bank operating and capital model does not apply to broker-dealers.';

function unsupportedPayload(): NativeUnifiedPayload {
  const base = biotechPayload(100_000_000);
  return {
    ...base,
    profile: { cik: '0000000000', ticker: 'TST', name: 'Test Broker' },
    model_eligibility: {
      ...base.model_eligibility,
      company_type: 'bank',
      subtype: 'investment_bank',
      preferred_model: 'unlevered_dcf',
      allowed_models: [],
      blocked_models: [{ model: 'bank_residual_income', reason: REASON }],
      supported_by_current_engine: false,
      status: 'unsupported',
      model_route_available: false,
    },
  } as unknown as NativeUnifiedPayload;
}

function stubBackend(data: NativeUnifiedPayload, captured: DcfWorkbookPayload[] = []): BackendPort {
  return {
    getUnifiedCompany: async () => data,
    exportDcf: async (payload) => {
      captured.push(payload);
      return new Uint8Array([1, 2, 3]);
    },
  };
}

describe('run-valuation-job unsupported issuer path', () => {
  it('stages a status workbook recording the refusal instead of throwing', async () => {
    const captured: DcfWorkbookPayload[] = [];
    const result = await runValuationJob('TST', stubBackend(unsupportedPayload(), captured));
    if (result.status !== 'unsupported') throw new Error(`expected unsupported, got ${result.status}`);

    expect(result.results).toBeNull();
    expect(result.profile.ticker).toBe('TST');
    expect(result.unsupported).toEqual({
      companyType: 'bank',
      subtype: 'investment_bank',
      attemptedModel: 'unlevered_dcf',
      reason: REASON,
    });
    expect(result.workbookBytes).toEqual(new Uint8Array([1, 2, 3]));
    expect(result.warnings).toEqual([expect.stringContaining('no valuation produced')]);
    expect(result.warnings[0]).toMatch(/unlevered_dcf workbook was not built and no substitute model was applied/);

    const payload = captured.at(0)!;
    expect(payload.buildStatus).toBe('unsupported');
    if (payload.buildStatus !== 'unsupported') throw new Error('expected unsupported payload');
    expect(payload.company).toMatchObject({ name: 'Test Broker', ticker: 'TST', unitsScale: 'millions' });
    // Fail closed: no valuation inputs may ride along with a refused issuer.
    expect(payload).not.toHaveProperty('historicals');
    expect(payload).not.toHaveProperty('market');
    expect(payload).not.toHaveProperty('assumptions');
    expect(payload).not.toHaveProperty('valuationModel');
    expect(payload.uiMeta?.warnings).toEqual(result.warnings);
  });

  it('keeps the unsupported payload inside the export contract and rejects smuggled inputs', async () => {
    const captured: DcfWorkbookPayload[] = [];
    const result = await runValuationJob('TST', stubBackend(unsupportedPayload(), captured));
    if (result.status !== 'unsupported') throw new Error(`expected unsupported, got ${result.status}`);

    const parsed = parseDcfExportPayload(captured.at(0));
    expect(parsed.buildStatus).toBe('unsupported');
    if (parsed.buildStatus !== 'unsupported') throw new Error('expected unsupported payload');
    expect(parsed.unsupported).toEqual(result.unsupported);

    expect(() => parseDcfExportPayload({ ...captured.at(0), market: { currentPrice: 10 } }))
      .toThrow(/cannot carry market/);
    expect(() => parseDcfExportPayload({ ...captured.at(0), valuationModel: 'unlevered_dcf' }))
      .toThrow(/cannot carry valuationModel/);
    expect(() => parseDcfExportPayload({ ...captured.at(0), unsupported: undefined }))
      .toThrow(/export\.unsupported/);
  });

  it('reports the refusal in CLI output instead of a valuation summary', async () => {
    const result = await runValuationJob('TST', stubBackend(unsupportedPayload()));
    const text = formatValuationJobSuccess(result, 'out/TST.xlsx');

    expect(text).toContain('Test Broker (TST)');
    expect(text).toContain('Status: UNSUPPORTED — no valuation was calculated.');
    expect(text).toContain(`Reason: ${REASON}`);
    expect(text).toContain('Model refused: unlevered_dcf. No substitute model was applied.');
  });
});
