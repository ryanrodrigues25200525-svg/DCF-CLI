import { describe, expect, it } from 'vitest';
import { getPrecedentTransactionsBySector } from '@/core/data/precedent-transactions.js';

describe('precedent transactions sector fallback (#49)', () => {
  it('returns mapped SOFTWARE comps for Technology', () => {
    const txns = getPrecedentTransactionsBySector('Technology');
    expect(txns.length).toBeGreaterThan(0);
  });

  it('does not return SOFTWARE comps for unmapped sectors', () => {
    const txns = getPrecedentTransactionsBySector('Utilities: Regulated Electric');
    const software = getPrecedentTransactionsBySector('Technology');
    expect(txns).toEqual([]);
    expect(software.length).toBeGreaterThan(0);
  });
});
