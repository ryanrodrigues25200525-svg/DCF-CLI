import type {
    CanonicalAnnualFinancials,
    CanonicalFinancialLine,
    CanonicalFinancialsPayload,
    BankHistoricalData,
    BankHistoricalYear,
    InsuranceHistoricalData,
    InsuranceHistoricalYear,
    ReitHistoricalData,
    ReitHistoricalYear,
    AssetManagerHistoricalData,
    AssetManagerHistoricalYear,
    TelecomHistoricalData,
    TelecomHistoricalYear,
    MortgageReitHistoricalData,
    MortgageReitHistoricalYear,
    EnergyHistoricalData,
    EnergyHistoricalYear,
    PharmaHistoricalData,
    PharmaHistoricalYear,
    CompanyProfile,
    HistoricalData,
    NativeFinancialsPayload,
    NativeMarketSnapshot,
    NativeProfilePayload,
} from "@/core/types";

type AnyRecord = Record<string, unknown>;
type CanonicalMetric = Exclude<keyof CanonicalAnnualFinancials, "year">;

function asRecord(value: unknown): AnyRecord {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value as AnyRecord
        : {};
}

function toPositiveOrNull(value: unknown): number | null {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function mapNativeProfile(
    profileRaw: NativeProfilePayload | unknown,
    nativeFinancialsRaw: NativeFinancialsPayload | unknown,
    marketRaw: unknown,
): CompanyProfile {
    const profile = asRecord(profileRaw);
    const nativeFinancials = asRecord(nativeFinancialsRaw);
    const market = asRecord(marketRaw);

    return {
        cik: String(profile.cik || nativeFinancials.cik || ""),
        ticker: String(profile.ticker || nativeFinancials.ticker || "").toUpperCase(),
        name: String(profile.name || nativeFinancials.name || "Unknown"),
        exchange: String(profile.exchange || "Unknown"),
        fiscalYearEnd: String(
            profile.fiscalYearEnd || profile.fiscal_year_end || nativeFinancials.fiscal_year_end || "",
        ),
        sic: typeof profile.sic === "string" ? profile.sic : undefined,
        sicDescription: typeof profile.sic_description === "string" ? profile.sic_description : undefined,
        currency: typeof profile.currency === "string"
            ? profile.currency
            : typeof market.currency === "string"
                ? market.currency
                : null,
        sector: String(profile.sector || market.sector || "Unknown"),
        industry: String(profile.industry || market.industry || "Unknown"),
        currentPrice: toPositiveOrNull(profile.currentPrice ?? profile.current_price ?? market.current_price),
        marketCap: toPositiveOrNull(profile.marketCap ?? profile.market_cap ?? market.market_cap),
        beta: toPositiveOrNull(profile.beta ?? market.beta),
    };
}

function lineFor(annual: CanonicalAnnualFinancials, field: CanonicalMetric): CanonicalFinancialLine {
    return annual[field] as CanonicalFinancialLine;
}

export function mapCanonicalFinancialsToHistoricals(
    canonical: CanonicalFinancialsPayload,
    marketRaw: NativeMarketSnapshot | unknown,
    profile: CompanyProfile,
): HistoricalData {
    const market = asRecord(marketRaw);
    const series = (field: CanonicalMetric): Array<number | null> =>
        canonical.annual.map((annual) => lineFor(annual, field).value);

    const sourceData: Record<string, CanonicalFinancialLine[]> = {};
    const canonicalFields = canonical.annual.length > 0
        ? Object.keys(canonical.annual[canonical.annual.length - 1] ?? {}).filter((field) => ![
            'year', 'bank', 'insurance', 'reit', 'asset_manager', 'telecom', 'mortgage_reit', 'energy', 'pharma',
        ].includes(field))
        : [];
    for (const field of canonicalFields) {
        sourceData[field] = canonical.annual.map((annual) => lineFor(annual, field as CanonicalMetric));
    }

    const latest = canonical.latest;
    const sourceWarnings = latest
        ? Object.entries(latest).flatMap(([field, value]) => {
            if (field === "year" || !value || typeof value !== "object" || !("source" in value)) return [];
            const line = value as CanonicalFinancialLine;
            return line.source === "ambiguous"
                ? [`FY${latest.year} ${field}: SEC concept match is ambiguous.`]
                : [];
        })
        : [];

    const currency = canonical.currency ?? (typeof market.currency === "string" ? market.currency : null);
    return {
        symbol: profile.ticker,
        years: canonical.years,
        revenue: series("revenue"),
        costOfRevenue: series("cost_of_revenue"),
        grossProfit: series("gross_profit"),
        purchases: series("cost_of_revenue"),
        ebitda: series("ebitda"),
        ebit: series("ebit"),
        interestExpense: series("interest_expense"),
        incomeTaxExpense: series("income_tax_expense"),
        netIncome: series("net_income"),
        depreciation: series("depreciation"),
        capex: series("capex"),
        nwcChange: series("nwc_change"),
        operatingNetWorkingCapital: series("operating_net_working_capital"),
        stockBasedComp: series("stock_based_comp"),
        taxRate: series("tax_rate"),
        dividendsPaid: series("dividends_paid"),
        marketableSecurities: series("marketable_securities"),
        preferredEquity: series("preferred_equity"),
        cfo: series("cfo"),
        fcff: series("fcff"),
        accountsReceivable: series("accounts_receivable"),
        inventory: series("inventory"),
        accountsPayable: series("accounts_payable"),
        marketing: series("marketing"),
        generalAndAdministrative: series("general_and_administrative"),
        researchAndDevelopment: series("research_and_development"),
        rent: series("rent"),
        badDebt: series("bad_debt"),
        otherOperatingExpenses: series("other_operating_expenses"),
        deferredTax: series("deferred_tax"),
        otherNonCash: series("other_non_cash"),
        cash: series("cash"),
        totalCurrentAssets: series("total_current_assets"),
        otherCurrentAssets: series("other_current_assets"),
        totalAssets: series("total_assets"),
        totalDebt: series("debt"),
        currentDebt: series("current_debt"),
        longTermDebt: series("long_term_debt"),
        operatingLeaseLiabilities: series("lease_liabilities"),
        shareholdersEquity: series("book_value"),
        nonControllingInterest: series("non_controlling_interest"),
        balanceSheetCheck: series("balance_sheet_check"),
        ppeNet: series("ppe_net"),
        otherAssets: series("other_assets"),
        otherLiabilities: series("other_liabilities"),
        totalLiabilities: series("total_liabilities"),
        totalCurrentLiabilities: series("total_current_liabilities"),
        otherCurrentLiabilities: series("other_current_liabilities"),
        deferredRevenue: series("deferred_revenue"),
        retainedEarnings: series("retained_earnings"),
        sharesOutstanding: latest ? lineFor(latest, "shares").value : null,
        price: toPositiveOrNull(market.current_price),
        beta: toPositiveOrNull(market.beta),
        currency,
        sector: profile.sector,
        industry: profile.industry,
        tradingCurrency: typeof market.currency === "string" ? market.currency : null,
        lastUpdated: typeof market.fetched_at_ms === "number" ? market.fetched_at_ms : undefined,
        normalizationWarnings: sourceWarnings,
        sourceData,
    };
}

export function mapCanonicalBankFinancialsToHistoricals(
    canonical: CanonicalFinancialsPayload,
): BankHistoricalData {
    if (!Array.isArray(canonical.annual) || canonical.annual.length === 0) {
        throw new Error('Canonical bank history is unavailable.');
    }
    const annual: BankHistoricalYear[] = canonical.annual.map((item) => {
        if (!item.bank) throw new Error(`FY${item.year} bank-specific SEC history is unavailable.`);
        return {
            year: item.year,
            bank: item.bank,
            totalRevenue: item.revenue,
            netIncome: item.net_income,
            taxRate: item.tax_rate,
        };
    });
    return {years: annual.map((item) => item.year), annual};
}

export function mapCanonicalInsuranceFinancialsToHistoricals(
    canonical: CanonicalFinancialsPayload,
): InsuranceHistoricalData {
    if (!Array.isArray(canonical.annual) || canonical.annual.length === 0) {
        throw new Error('Canonical insurance history is unavailable.');
    }
    const annual: InsuranceHistoricalYear[] = canonical.annual.map((item) => ({
        year: item.year,
        insurance: item.insurance ?? null,
        totalRevenue: item.revenue,
        netIncome: item.net_income,
        taxRate: item.tax_rate,
    }));
  return {years: annual.map((item) => item.year), annual};
}

export function mapCanonicalReitFinancialsToHistoricals(
    canonical: CanonicalFinancialsPayload,
): ReitHistoricalData {
    if (!Array.isArray(canonical.annual) || canonical.annual.length < 3) {
        throw new Error('REIT model requires three filed annual periods.');
    }
    const annual: ReitHistoricalYear[] = canonical.annual.slice(-3).map((item) => {
        if (!item.reit) throw new Error(`FY${item.year} REIT-specific SEC history is unavailable.`);
        return {
            year: item.year,
            reit: item.reit,
            netIncome: item.net_income,
            commonEquity: item.book_value,
            cash: item.cash,
            longTermDebt: item.long_term_debt,
            preferredEquity: item.preferred_equity,
            nonControllingInterest: item.non_controlling_interest,
            dilutedShares: item.shares,
        };
    });
    return {years: annual.map((item) => item.year), annual};
}

export function mapCanonicalMortgageReitFinancialsToHistoricals(
    canonical: CanonicalFinancialsPayload,
): MortgageReitHistoricalData {
    if (canonical.currency?.toUpperCase() !== 'USD') throw new Error('Mortgage REIT model requires USD-denominated canonical financials.');
    if (!Array.isArray(canonical.annual) || canonical.annual.length < 3) throw new Error('Mortgage REIT model requires three filed annual periods.');
    const available = canonical.annual.filter((item) => item.mortgage_reit?.tangible_book_value_per_common_share.source === 'sec_native');
    if (available.length < 4) throw new Error('Mortgage REIT model requires an opening book value and three filed forecast-base years.');
    const recent = available.slice(-4);
    const annual: MortgageReitHistoricalYear[] = recent.map((item, index) => {
        if (!item.mortgage_reit) throw new Error(`FY${item.year} mortgage-REIT SEC history is unavailable.`);
        if (index > 0 && item.year !== recent[index - 1]!.year + 1) throw new Error('Mortgage REIT model requires four consecutive fiscal years.');
        return {
            year: item.year,
            mortgageReit: item.mortgage_reit,
            netIncome: item.net_income,
            taxRate: item.tax_rate,
            cash: item.cash,
            marketableSecurities: item.marketable_securities,
            nonControllingInterest: item.non_controlling_interest,
            dilutedShares: item.shares,
        };
    });
    return {years: annual.map((item) => item.year), annual};
}

export function mapCanonicalEnergyFinancialsToHistoricals(
    canonical: CanonicalFinancialsPayload,
): EnergyHistoricalData {
    if (canonical.currency?.toUpperCase() !== 'USD') throw new Error('Integrated energy DCF requires USD-denominated canonical financials.');
    if (!Array.isArray(canonical.annual) || canonical.annual.length < 3) throw new Error('Integrated energy DCF requires three filed annual periods.');
    const recent = canonical.annual.slice(-3);
    const annual: EnergyHistoricalYear[] = recent.map((item, index) => {
        if (!item.energy) throw new Error(`FY${item.year} integrated-energy SEC schedules are unavailable.`);
        if (index > 0 && item.year !== recent[index - 1]!.year + 1) throw new Error('Integrated energy DCF requires three consecutive fiscal years.');
        return {
            year: item.year,
            energy: item.energy,
            revenue: item.revenue,
            netIncome: item.net_income,
            interestExpense: item.interest_expense,
            taxRate: item.tax_rate,
            depreciation: item.depreciation,
            cashFlowFromOperations: item.cfo,
            cash: item.cash,
            currentDebt: item.energy.current_debt,
            longTermDebt: item.energy.long_term_debt,
            debt: item.energy.interest_bearing_debt,
            marketableSecurities: item.marketable_securities,
            preferredEquity: item.preferred_equity,
            nonControllingInterest: item.non_controlling_interest,
            dilutedShares: item.energy.weighted_average_diluted_shares,
        };
    });
    return {years: annual.map((item) => item.year), annual};
}

export function mapCanonicalPharmaFinancialsToHistoricals(
    canonical: CanonicalFinancialsPayload,
): PharmaHistoricalData {
    if (canonical.currency?.toUpperCase() !== 'USD') throw new Error('Mature-pharma DCF requires USD-denominated canonical financials.');
    if (!Array.isArray(canonical.annual) || canonical.annual.length < 3) throw new Error('Mature-pharma DCF requires three filed annual periods.');
    const recent = canonical.annual.slice(-3);
    const annual: PharmaHistoricalYear[] = recent.map((item, index) => {
        if (!item.pharma) throw new Error(`FY${item.year} mature-pharma product and patent schedules are unavailable.`);
        if (index > 0 && item.year !== recent[index - 1]!.year + 1) throw new Error('Mature-pharma DCF requires three consecutive fiscal years.');
        return {
            year: item.year,
            pharma: item.pharma,
            revenue: item.revenue,
            ebit: item.ebit,
            interestExpense: item.interest_expense,
            taxRate: item.tax_rate,
            depreciation: item.depreciation,
            capex: item.capex,
            nwcChange: item.nwc_change,
            cash: item.cash,
            marketableSecurities: item.marketable_securities,
            debt: item.debt,
            nonControllingInterest: item.non_controlling_interest,
            preferredEquity: item.preferred_equity,
            dilutedShares: item.shares,
        };
    });
    return {years: annual.map((item) => item.year), annual};
}

export function mapCanonicalAssetManagerFinancialsToHistoricals(
    canonical: CanonicalFinancialsPayload,
): AssetManagerHistoricalData {
    if (canonical.currency?.toUpperCase() !== 'USD') {
        throw new Error('Asset-manager AUM DCF requires USD-denominated canonical financials.');
    }
    if (!Array.isArray(canonical.annual) || canonical.annual.length < 3) {
        throw new Error('Asset-manager AUM DCF requires three filed annual periods.');
    }
    const annual: AssetManagerHistoricalYear[] = canonical.annual.slice(-3).map((item, index, recent) => {
        if (!item.asset_manager) throw new Error(`FY${item.year} asset-manager SEC history is unavailable.`);
        if (index > 0 && item.year !== recent[index - 1]!.year + 1) {
            throw new Error('Asset-manager AUM DCF requires three consecutive fiscal years.');
        }
        return {
            year: item.year,
            assetManager: item.asset_manager,
            revenue: item.revenue,
            ebit: item.ebit,
            interestExpense: item.interest_expense,
            incomeTaxExpense: item.income_tax_expense,
            taxRate: item.tax_rate,
            depreciation: item.depreciation,
            capex: item.capex,
            nwcChange: item.nwc_change,
            cash: item.cash,
            marketableSecurities: item.marketable_securities,
            debt: item.debt,
            leaseLiabilities: item.lease_liabilities,
            nonControllingInterest: item.non_controlling_interest,
            preferredEquity: item.preferred_equity,
            dilutedShares: item.shares,
        };
    });
    return {years: annual.map((item) => item.year), annual};
}

export function mapCanonicalTelecomFinancialsToHistoricals(
    canonical: CanonicalFinancialsPayload,
): TelecomHistoricalData {
    if (canonical.currency?.toUpperCase() !== 'USD') {
        throw new Error('Telecom subscriber DCF requires USD-denominated canonical financials.');
    }
    if (!Array.isArray(canonical.annual) || canonical.annual.length < 3) {
        throw new Error('Telecom subscriber DCF requires three filed annual periods.');
    }
    const available = canonical.annual.filter((item) => item.telecom?.wireless_subscribers.source === 'sec_native');
    if (available.length < 4) throw new Error('Telecom subscriber DCF requires an opening customer balance and three filed annual periods.');
    const recent = available.slice(-4);
    const annual: TelecomHistoricalYear[] = recent.map((item, index) => {
        if (!item.telecom) throw new Error(`FY${item.year} telecom-specific SEC history is unavailable.`);
        if (index > 0 && item.year !== recent[index - 1]!.year + 1) {
            throw new Error('Telecom subscriber DCF requires four consecutive annual customer observations.');
        }
        return {
            year: item.year,
            telecom: item.telecom,
            revenue: item.revenue,
            ebit: item.ebit,
            interestExpense: item.interest_expense,
            taxRate: item.tax_rate,
            depreciation: item.depreciation,
            capex: item.telecom.capital_expenditures,
            nwcChange: item.telecom.working_capital_change,
            cash: item.cash,
            marketableSecurities: item.marketable_securities,
            debt: item.telecom.interest_bearing_debt,
            nonControllingInterest: item.non_controlling_interest,
            preferredEquity: item.preferred_equity,
            dilutedShares: item.shares,
        };
    });
    return {years: annual.map((item) => item.year), annual};
}
