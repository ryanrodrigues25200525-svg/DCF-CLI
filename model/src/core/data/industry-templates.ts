import { Assumptions } from '@/core/types';

export type IndustryPresetKey =
  | "tech-hardware"
  | "tech-saas"
  | "consumer-discretionary"
  | "consumer-staples"
  | "industrials"
  | "healthcare"
  | "financials"
  | "energy"
  | "real-estate";

interface IndustryPresetValues {
  revenueCagr: number;
  terminalGrowth: number;
  grossMargin: number;
  ebitMargin: number;
  taxRate: number;
  capexPercent: number;
  daPercent: number;
  nwcPercent: number;
  beta: number;
  marketRiskPremium: number;
  terminalExitMultiple: number;
}

const INDUSTRY_PRESETS: Record<IndustryPresetKey, { name: string; assumptions: IndustryPresetValues }> = {
  "tech-hardware": {
    name: "Technology - Hardware",
    assumptions: {
      revenueCagr: 8,
      terminalGrowth: 2.5,
      grossMargin: 40,
      ebitMargin: 25,
      taxRate: 21,
      capexPercent: 3.5,
      daPercent: 3,
      nwcPercent: -2,
      beta: 1.1,
      marketRiskPremium: 5.5,
      terminalExitMultiple: 12.0
    }
  },
  "tech-saas": {
    name: "Technology - Software/SaaS",
    assumptions: {
      revenueCagr: 15,
      terminalGrowth: 3,
      grossMargin: 75,
      ebitMargin: 20,
      taxRate: 22,
      capexPercent: 2,
      daPercent: 1.5,
      nwcPercent: 5,
      beta: 1.3,
      marketRiskPremium: 6,
      terminalExitMultiple: 14.0
    }
  },
  "consumer-discretionary": {
    name: "Consumer Discretionary",
    assumptions: {
      revenueCagr: 6,
      terminalGrowth: 2,
      grossMargin: 45,
      ebitMargin: 15,
      taxRate: 23,
      capexPercent: 5,
      daPercent: 4,
      nwcPercent: 10,
      beta: 1.0,
      marketRiskPremium: 5.5,
      terminalExitMultiple: 10.0
    }
  },
  "consumer-staples": {
    name: "Consumer Staples",
    assumptions: {
      revenueCagr: 3,
      terminalGrowth: 2,
      grossMargin: 50,
      ebitMargin: 20,
      taxRate: 22,
      capexPercent: 4,
      daPercent: 3.5,
      nwcPercent: -5,
      beta: 0.6,
      marketRiskPremium: 5,
      terminalExitMultiple: 11.0
    }
  },
  "industrials": {
    name: "Industrials",
    assumptions: {
      revenueCagr: 5,
      terminalGrowth: 2.5,
      grossMargin: 30,
      ebitMargin: 12,
      taxRate: 21,
      capexPercent: 6,
      daPercent: 5,
      nwcPercent: 15,
      beta: 1.2,
      marketRiskPremium: 5.5,
      terminalExitMultiple: 10.0
    }
  },
  "healthcare": {
    name: "Healthcare",
    assumptions: {
      revenueCagr: 7,
      terminalGrowth: 2.5,
      grossMargin: 70,
      ebitMargin: 25,
      taxRate: 18,
      capexPercent: 3,
      daPercent: 2.5,
      nwcPercent: 12,
      beta: 0.8,
      marketRiskPremium: 5,
      terminalExitMultiple: 12.0
    }
  },
  "financials": {
    name: "Financial Services",
    assumptions: {
      revenueCagr: 5,
      terminalGrowth: 2,
      grossMargin: 100,
      ebitMargin: 30,
      taxRate: 20,
      capexPercent: 2,
      daPercent: 1,
      nwcPercent: 0,
      beta: 1.3,
      marketRiskPremium: 6,
      terminalExitMultiple: 9.0
    }
  },
  "energy": {
    name: "Energy & Utilities",
    assumptions: {
      revenueCagr: 3,
      terminalGrowth: 1.5,
      grossMargin: 40,
      ebitMargin: 15,
      taxRate: 21,
      capexPercent: 12,
      daPercent: 10,
      nwcPercent: 8,
      beta: 0.9,
      marketRiskPremium: 5,
      terminalExitMultiple: 7.0
    }
  },
  "real-estate": {
    name: "Real Estate",
    assumptions: {
      revenueCagr: 4,
      terminalGrowth: 2,
      grossMargin: 60,
      ebitMargin: 45,
      taxRate: 0,
      capexPercent: 15,
      daPercent: 12,
      nwcPercent: 2,
      beta: 0.7,
      marketRiskPremium: 5,
      terminalExitMultiple: 14.0
    }
  }
};

export function detectIndustryTemplate(ticker?: string, sector?: string, industry?: string): IndustryPresetKey | null {
  const s = `${sector || ""} ${industry || ""}`.toLowerCase();

  if (s.includes("telecom") || s.includes("wireless carrier") || s.includes("telecommunications")) return null;

  if (s.includes("software") || s.includes("saas") || s.includes("application")) return "tech-saas";
  if (s.includes("technology") || s.includes("semiconductor") || s.includes("computer") || s.includes("hardware") || s.includes("electronics")) return "tech-hardware";
  if (s.includes("consumer cyclical") || s.includes("consumer discretionary") || s.includes("retail") || s.includes("restaurant") || s.includes("travel") || s.includes("auto")) return "consumer-discretionary";
  if (s.includes("consumer defensive") || s.includes("consumer staples") || s.includes("beverage") || s.includes("food") || s.includes("household")) return "consumer-staples";
  if (s.includes("financial") || s.includes("bank") || s.includes("insurance") || s.includes("asset management")) return "financials";
  if (s.includes("health") || s.includes("pharma") || s.includes("biotech") || s.includes("medical")) return "healthcare";
  if (s.includes("industrial") || s.includes("aerospace") || s.includes("machinery") || s.includes("transport")) return "industrials";
  if (s.includes("energy") || s.includes("utility") || s.includes("oil") || s.includes("gas")) return "energy";
  if (s.includes("real estate") || s.includes("reit")) return "real-estate";

  return null;
}

export function applyIndustryTemplateAssumptions(base: Assumptions, templateKey: IndustryPresetKey): Assumptions {
  const preset = INDUSTRY_PRESETS[templateKey];
  if (!preset) return base;
  const p = preset.assumptions;
  const revenueGrowth = p.revenueCagr / 100;
  const ebitMargin = p.ebitMargin / 100;
  return {
    ...base,
    revenueGrowth,
    revenueGrowthStage1: revenueGrowth,
    terminalGrowthRate: p.terminalGrowth / 100,
    grossMargin: p.grossMargin / 100,
    ebitMargin,
    ebitMarginSteadyState: ebitMargin,
    taxRate: p.taxRate / 100,
    capexRatio: p.capexPercent / 100,
    deaRatio: p.daPercent / 100,
    nwcChangeRatio: p.nwcPercent / 100,
    beta: p.beta,
    equityRiskPremium: p.marketRiskPremium / 100,
    terminalExitMultiple: p.terminalExitMultiple
  };
}
