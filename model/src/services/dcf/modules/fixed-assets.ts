
import { Assumptions } from '@/core/types';

interface OverrideValues {
  dea?: number;
  capex?: number;
}

export interface FixedAssetsResult {
    capex: number;
    depreciation: number;
    endingPpeNet: number;
}

/**
 * Projects editable revenue-based CapEx and D&A drivers and the PP&E roll-forward.
 */
export function projectFixedAssets(
    revenue: number,
    ppeNet: number,
    assumptions: Assumptions,
    ov: OverrideValues // Overrides for the current year
): FixedAssetsResult {
    const depreciation = ov.dea ?? (revenue * assumptions.deaRatio);
    const capex = ov.capex ?? (revenue * assumptions.capexRatio);
    if (!Number.isFinite(depreciation) || depreciation < 0 || !Number.isFinite(capex) || capex < 0) {
        throw new Error('Forecast CapEx and D&A must be finite, non-negative amounts.');
    }

    const endingPpeNet = Math.max(0, ppeNet + capex - depreciation);

    return {
        capex,
        depreciation,
        endingPpeNet
    };
}
