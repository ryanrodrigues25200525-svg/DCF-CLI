import { describe, expect, it } from 'vitest';
import type { BackendPort } from '@/api/backend-client';
import type { NativeUnifiedPayload } from '@/core/types/native';
import { runValuationJob } from '@/application/run-valuation-job.js';
import { biotechPayload } from '@/services/valuation/specialist-test-fixtures.js';

function stubBackend(data: NativeUnifiedPayload): BackendPort {
  return {
    getUnifiedCompany: async () => data,
    exportDcf: async () => new Uint8Array([1, 2, 3]),
  };
}

describe('run-valuation-job specialist ready path (#43, #54, #57)', () => {
  it('pre-revenue biotech passes the revenue gate and reaches pipeline-economics validation', async () => {
    const data = biotechPayload(null);
    await expect(runValuationJob('TST', stubBackend(data))).rejects.toThrow(/pipeline asset economics/i);
    await expect(runValuationJob('TST', stubBackend(data))).rejects.not.toThrow(/positive revenue/i);
  });

  it('revenue-bearing biotech also reaches pipeline-economics validation, not the revenue gate', async () => {
    const data = biotechPayload(100_000_000);
    await expect(runValuationJob('TST', stubBackend(data))).rejects.toThrow(/pipeline asset economics/i);
  });
});
