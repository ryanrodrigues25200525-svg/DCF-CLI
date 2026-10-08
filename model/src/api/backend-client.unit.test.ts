import { describe, expect, it } from 'vitest';
import { BackendApiClient } from '@/api/backend-client.js';

function stubFetch(body: unknown, status: number): typeof fetch {
  return (async () => ({
    ok: false,
    status,
    text: async () => JSON.stringify(body),
    arrayBuffer: async () => new ArrayBuffer(0),
  })) as unknown as typeof fetch;
}

describe('backend error surfacing (#53)', () => {
  it('appends the backend request id and kind to opaque 500 failures', async () => {
    const client = new BackendApiClient(
      'http://127.0.0.1:1',
      stubFetch({
        error: { code: 'INTERNAL_SERVER_ERROR', message: 'An unexpected error occurred. Please try again later.', kind: 'KeyError' },
        request_id: 'req-123',
      }, 500),
    );
    await expect(client.getRecentFilings('TST')).rejects.toThrow(/req-123/);
    await expect(client.getRecentFilings('TST')).rejects.toThrow(/KeyError/);
  });

  it('keeps DATA_ERROR reasons verbatim', async () => {
    const client = new BackendApiClient(
      'http://127.0.0.1:1',
      stubFetch({
        error: { code: 'DATA_ERROR', message: 'median does not reconcile', reason: 'median does not reconcile' },
        request_id: 'req-456',
      }, 422),
    );
    await expect(client.getRecentFilings('TST')).rejects.toThrow(/median does not reconcile/);
  });
});
