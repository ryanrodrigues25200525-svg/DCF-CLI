import type {
  CanonicalFinancialLine,
  NativeUnifiedPayload,
  PipelineAssetNativeFact,
} from '@/core/types/native';
import type { BiotechRnpvAssumptions } from '@/services/valuation/biotech-rnpv-model';
import { selectBiotechAssetsForRnpv } from '@/services/valuation/biotech-rnpv-model';
import type { LifeInsuranceDcfAssumptions } from '@/services/valuation/life-insurance-model';
import { resolveLifeSourceContract } from '@/services/valuation/life-source-contract.js';
import type { UtilityModelAssumptions } from '@/services/valuation/utility-model';

function filedNumber(line: CanonicalFinancialLine | null | undefined): number | null {
  return typeof line?.value === 'number' && Number.isFinite(line.value) ? line.value : null;
}

function requirePositive(value: number | null, label: string): number {
  if (value === null || value <= 0) throw new Error(`${label} is missing from filed sources.`);
  return value;
}

/**
 * Ready-path assumption builders for analyst-input specialist routes
 * (utility/biotech/life, #43). Each builder extracts every filed fact the
 * backend ships today and throws a named error for the analyst-only inputs
 * the route still needs — never a fabricated assumption. The throw sites are
 * the contract the backend must satisfy before these routes can go ready.
 */
export function buildSourcedUtilityModelAssumptions(_data: NativeUnifiedPayload): UtilityModelAssumptions {
  throw new Error(
    'Utility DCF ready valuation requires filed jurisdictional rate-base facts '
    + '(baseRateBase, five-year rateBaseAdditions/rateBaseDepreciation, authorizedEquityRatio, allowedRoe, '
    + 'dividendPayoutRatio); no utility canonical section is filed, so the route stays analyst-input.',
  );
}

export function buildSourcedBiotechRnpvAssumptions(data: NativeUnifiedPayload): BiotechRnpvAssumptions {
  const latest = data.canonical_financials.latest;
  if (!latest) throw new Error('Biotech rNPV requires a latest filed commercial-revenue base.');
  const commercialRevenueBase = filedNumber(latest.revenue) ?? 0;
  if (commercialRevenueBase < 0) throw new Error('Biotech rNPV requires a non-negative filed commercial-revenue base.');
  const rawAssets = data.financials_native.pipeline_assets;
  const inventory: PipelineAssetNativeFact[] = Array.isArray(rawAssets) ? rawAssets : [];
  const modeled = selectBiotechAssetsForRnpv(inventory);
  if (modeled.length === 0) {
    throw new Error('Biotech rNPV requires a source-backed pipeline asset inventory with phase 2+ assets.');
  }
  const marketCap = requirePositive(
    typeof data.market.market_cap === 'number' ? data.market.market_cap : null,
    'Biotech rNPV current market capitalization',
  );
  void marketCap;
  throw new Error(
    'Biotech rNPV ready valuation requires analyst pipeline asset economics and commercial-franchise inputs '
    + '(per-asset launch timing, peak sales, success probabilities, retained economics, development costs, '
    + 'ten-year commercial revenue growth, commercial FCF margin, debt cost, normalized tax rate, terminal growth); '
    + 'filings carry the asset inventory, revenue base, market, and equity bridge only.',
  );
}

export function buildSourcedLifeInsuranceAssumptions(data: NativeUnifiedPayload): LifeInsuranceDcfAssumptions {
  const facts = data.financials_native.life_insurance_filing_facts;
  const contract = resolveLifeSourceContract(Array.isArray(facts) ? facts : []);
  if (!contract) {
    throw new Error('Life-insurer ready valuation requires a resolved filing-derived life source contract.');
  }
  throw new Error(
    'Life-insurer ready valuation requires analyst segment earnings forecasts, a statutory capital schedule, '
    + 'permitted upstream dividend capacity, the holding-company cash bridge, and terminal growth; '
    + 'filings carry the segment/capital source contract, market, and share count only.',
  );
}
