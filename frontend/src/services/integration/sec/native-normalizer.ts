import {
    CompanyProfile,
    HistoricalData,
    NativeFinancialsPayload,
    NativeProfilePayload,
    NativeStatementRow,
    NativeUnifiedPayload,
} from "@/core/types";

type AnyRecord = Record<string, unknown>;

const YEAR_IN_KEY_RE = /(?:19|20)\d{2}/;

type NormRow = NativeStatementRow & { _std: string; _concept: string; _label: string; _isAbstract: boolean };

const asRecord = (value: unknown): AnyRecord =>
    value && typeof value === "object" ? (value as AnyRecord) : {};

const asRows = (value: unknown): NativeStatementRow[] => {
    if (Array.isArray(value)) return value as NativeStatementRow[];
    if (!value || typeof value !== "object") return [];
    const rec = value as AnyRecord;
    for (const key of ["rows", "data", "items"]) {
        if (Array.isArray(rec[key])) return rec[key] as NativeStatementRow[];
    }
    return [];
};

const normalizeKey = (value: unknown): string =>
    String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "");

const toNumber = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
};

const toPositiveNumber = (value: unknown): number => {
    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
};

const deriveSharesFromMarketValue = (marketRaw: AnyRecord, profileRaw: AnyRecord): number => {
    const price = toPositiveNumber(marketRaw.current_price ?? profileRaw.currentPrice ?? profileRaw.current_price);
    const marketCap = toPositiveNumber(marketRaw.market_cap ?? profileRaw.marketCap ?? profileRaw.market_cap);
    return price > 0 && marketCap > 0 ? marketCap / price : 0;
};

const toBoolean = (value: unknown): boolean => {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    if (typeof value === "string") {
        const normalized = value.trim().toLowerCase();
        return normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "y";
    }
    return false;
};

const parseYearFromColumn = (key: string): number | null => {
    const match = key.match(YEAR_IN_KEY_RE);
    if (!match) return null;
    const year = Number(match[0]);
    return Number.isFinite(year) ? year : null;
};

const findYearCoverage = (rows: NativeStatementRow[]): Map<number, string> => {
    const yearToCol = new Map<number, string>();
    for (const row of rows) {
        for (const key of Object.keys(row)) {
            const year = parseYearFromColumn(key);
            if (year === null) continue;
            const existing = yearToCol.get(year);
            if (!existing || key > existing) {
                yearToCol.set(year, key);
            }
        }
    }
    return yearToCol;
};

const rowValueForYear = (row: NativeStatementRow, year: number): unknown => {
    let selectedKey: string | null = null;
    for (const key of Object.keys(row)) {
        const y = parseYearFromColumn(key);
        if (y !== year) continue;
        if (!selectedKey || key > selectedKey) {
            selectedKey = key;
        }
    }
    if (!selectedKey) return undefined;
    return row[selectedKey];
};

const getStatementRows = (statementsRaw: unknown, kind: "income" | "balance" | "cashflow"): NativeStatementRow[] => {
    const statements = asRecord(statementsRaw);
    const keyOptions =
        kind === "income"
            ? ["income_statement", "incomeStatement", "income", "statement_of_income"]
            : kind === "balance"
                ? ["balance_sheet", "balanceSheet", "balance", "statement_of_financial_position"]
                : ["cashflow_statement", "cash_flow_statement", "cashflow", "cash_flow", "cashFlow", "statement_of_cash_flows"];

    for (const key of keyOptions) {
        const rows = asRows(statements[key]);
        if (rows.length > 0) return rows;
    }

    for (const [key, value] of Object.entries(statements)) {
        const normalized = normalizeKey(key);
        if (kind === "income" && normalized.includes("income")) {
            const rows = asRows(value);
            if (rows.length > 0) return rows;
        }
        if (kind === "balance" && (normalized.includes("balance") || normalized.includes("financialposition"))) {
            const rows = asRows(value);
            if (rows.length > 0) return rows;
        }
        if (kind === "cashflow" && normalized.includes("cash")) {
            const rows = asRows(value);
            if (rows.length > 0) return rows;
        }
    }

    return [];
};

export function mapNativeProfile(
    profileRaw: NativeProfilePayload | unknown,
    nativeFinancialsRaw: NativeFinancialsPayload | unknown,
    marketRaw: unknown
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
            profile.fiscalYearEnd || profile.fiscal_year_end || nativeFinancials.fiscal_year_end || ""
        ),
        currency: String(profile.currency || market.currency || "USD"),
        sector: String(profile.sector || market.sector || "Unknown"),
        industry: String(profile.industry || market.industry || "Unknown"),
        currentPrice: toPositiveNumber(profile.currentPrice ?? profile.current_price ?? market.current_price),
        marketCap: toPositiveNumber(profile.marketCap ?? profile.market_cap ?? market.market_cap),
        beta: toPositiveNumber(profile.beta ?? market.beta) || 1,
    };
}

export function mapNativeFinancialsToHistoricals(
    nativeFinancialsRaw: NativeFinancialsPayload | unknown,
    marketRaw: unknown,
    profileRaw: unknown
): HistoricalData {
    const nativeFinancials = asRecord(nativeFinancialsRaw);
    const market = asRecord(marketRaw);
    const profile = asRecord(profileRaw);
    const statements = nativeFinancials.statements;
    const incomeRows = getStatementRows(statements, "income");
    const balanceRows = getStatementRows(statements, "balance");
    const cashRows = getStatementRows(statements, "cashflow");
    const allRows = [...incomeRows, ...balanceRows, ...cashRows];

    const yearToCol = findYearCoverage(allRows);
    const years = [...yearToCol.keys()].sort((a, b) => a - b);
    const keyMetrics = asRecord(nativeFinancials.key_metrics);
    const fallbackYear = new Date().getFullYear();
    const usableYears = years.length > 0 ? years : [fallbackYear];

    const fieldRules: Record<
        string,
        {
            standard?: string[];
            concept?: string[];
            label?: string[];
            exactStandard?: string[];
            exactConcept?: string[];
            exactLabel?: string[];
            excludeConcept?: string[];
            excludeLabel?: string[];
        }
    > = {
        revenue: { standard: ["revenue", "contractrevenue", "productrevenue", "servicerevenue", "subscriptionrevenue"] },
        costOfRevenue: { standard: ["costofrevenue", "costofgoodssold", "costofsales", "costofgoodsandservicessold"] },
        grossProfit: { standard: ["grossprofit"] },
        ebit: {
            exactStandard: ["operatingincome", "operatingincomeloss"],
            exactConcept: ["operatingincome", "operatingincomeloss"],
            exactLabel: ["operating income", "operating income (loss)", "income from operations"],
            excludeConcept: ["nonoperating", "nonoperatingincomeexpense"],
            excludeLabel: ["non-operating", "nonoperating"],
        },
        interestExpense: { standard: ["interestexpense"] },
        incomeTaxExpense: { standard: ["incometaxexpense"] },
        netIncome: { standard: ["netincome", "netincomefromcontinuingoperations", "profitorloss"] },
        researchAndDevelopment: { standard: ["researchanddevelopmentexpense"] },
        generalAndAdministrative: {
            standard: ["sellinggeneralandadministrativeexpense", "generalandadministrativeexpense", "sellingexpense", "marketingexpense", "salesexpense"]
        },
        cash: { standard: ["cashandcashequivalents", "cashandcashequivalentsatcarryingvalue"] },
        cashAndMarketableCombined: {
            standard: ["cashandmarketablesecurities", "cashcashequivalentsandshortterminvestments"]
        },
        accountsReceivable: { standard: ["accountsreceivable"] },
        inventory: { standard: ["inventory"] },
        totalCurrentAssets: {
            exactStandard: ["totalcurrentassets", "currentassetstotal", "assetscurrent"],
            exactConcept: ["assetscurrent"],
            exactLabel: ["total current assets", "current assets"],
        },
        ppeNet: {
            standard: ["plantpropertyequipmentnet", "propertyplantandequipment", "propertyplantequipment"],
            concept: ["propertyplantandequipmentnet", "propertyplantequipment"],
            label: ["property, plant and equipment", "property, plant & equipment"]
        },
        otherCurrentAssets: {
            standard: ["othercurrentassets", "prepaidexpenseandotherassetscurrent"]
        },
        otherAssets: {
            standard: ["goodwill", "intangibleassets", "otherassetsnoncurrent", "otherassets"],
            excludeConcept: ["othercurrentassets", "otherassetscurrent"],
            excludeLabel: ["other current assets"],
        },
        totalAssets: {
            exactStandard: ["totalassets", "assets"],
            exactConcept: ["assets"],
            exactLabel: ["total assets", "assets"],
        },
        accountsPayable: { standard: ["accountspayable"] },
        otherCurrentLiabilities: {
            standard: ["accruedliabilities", "operatingleaseliabilitycurrent", "otherliabilitiescurrent"]
        },
        currentDebt: {
            standard: [
                "shorttermdebt",
                "debtcurrent",
                "longtermdebtcurrent",
                "currentportionoflongtermdebt",
                "currentportionoflongtermdebtandcapitalleaseobligations"
            ]
        },
        totalCurrentLiabilities: {
            exactStandard: ["totalcurrentliabilities", "currentliabilitiestotal", "liabilitiescurrent"],
            exactConcept: ["liabilitiescurrent"],
            exactLabel: ["total current liabilities", "current liabilities"],
        },
        longTermDebt: { standard: ["longtermdebt", "longtermdebtnoncurrent"] },
        deferredRevenue: { standard: ["deferredrevenue"] },
        otherLiabilities: {
            standard: ["otherliabilitiesnoncurrent", "otherliabilities"],
            excludeConcept: ["othercurrentliabilities", "otherliabilitiescurrent"],
            excludeLabel: ["other current liabilities"],
        },
        totalLiabilities: {
            exactStandard: ["totalliabilities", "liabilities"],
            exactConcept: ["liabilities"],
            exactLabel: ["total liabilities", "liabilities"],
            excludeConcept: ["liabilitiesandstockholdersequity", "liabilitiesandequity"],
            excludeLabel: ["liabilities and equity", "liabilities and stockholders' equity"]
        },
        liabilitiesAndEquity: {
            standard: ["liabilitiesandstockholdersequity", "liabilitiesandequity"],
            concept: ["liabilitiesandstockholdersequity", "liabilitiesandequity"],
            label: ["total liabilities and equity", "liabilities and equity", "liabilities and stockholders' equity"]
        },
        shareholdersEquity: {
            standard: ["allequitybalance", "totalstockholdersequity", "stockholdersequity", "stockholdersequityattributabletoparent"],
            concept: ["stockholdersequity", "stockholdersequityattributabletoparent", "totalequity"],
            label: ["stockholders' equity", "shareholders' equity", "stockholders equity attributable to parent"],
            excludeConcept: ["liabilitiesandstockholdersequity", "liabilitiesandequity", "redeemablenoncontrollinginterest"],
            excludeLabel: ["liabilities and equity", "liabilities and stockholders' equity"]
        },
        retainedEarnings: { standard: ["retainedearnings"] },
        cfo: { standard: ["netcashfromoperatingactivities"] },
        capex: {
            concept: ["paymentstoacquirepropertyplantandequipment", "paymentsforpurchaseofpropertyplantandequipment", "capitalexpenditures", "purchaseofpropertyplantandequipment"],
            label: ["capitalexpenditure", "capital expenditures", "purchase of property"]
        },
        depreciation: { concept: ["depreciationandamortization", "depreciationdepletionandamortization", "depreciation", "amortization"] },
        marketableSecurities: {
            standard: ["cashandmarketablesecurities", "shortterminvestments", "marketablesecurities"],
            concept: ["marketablesecurities", "shortterminvestments", "longterminvestments", "investments"]
        },
        dividendsPaid: { concept: ["paymentsofdividends", "dividendspaid", "cashdividendspaid", "netcashpaymentsofdividends"] },
        stockBasedComp: { concept: ["sharebasedcompensation", "stockbasedcompensation"] },
    };

    const rowMatchesField = (
        row: NativeStatementRow & { _std?: string; _concept?: string; _label?: string; _isAbstract?: boolean },
        rule: {
            standard?: string[];
            concept?: string[];
            label?: string[];
            exactStandard?: string[];
            exactConcept?: string[];
            exactLabel?: string[];
            excludeConcept?: string[];
            excludeLabel?: string[];
        }
    ): boolean => {
        if (row._isAbstract) return false;
        const std = row._std ?? "";
        const concept = row._concept ?? "";
        const label = row._label ?? "";

        if (rule.excludeConcept?.some((needle) => concept.includes(needle))) return false;
        if (rule.excludeLabel?.some((needle) => label.includes(needle))) return false;

        if (rule.exactStandard?.some((needle) => std === needle)) return true;
        if (rule.exactConcept?.some((needle) => concept === needle)) return true;
        if (rule.exactLabel?.some((needle) => label === needle)) return true;

        // edgartools may omit `standard_concept`; use the same tokens against concept/label by default.
        if (rule.standard?.some((needle) =>
            std.includes(needle) || concept.includes(needle) || label.includes(needle)
        )) return true;
        if (rule.concept?.some((needle) => concept.includes(needle))) return true;
        if (rule.label?.some((needle) => label.includes(needle))) return true;
        return false;
    };

    // Precompute normalized row keys once and normalized field rules once to avoid repeated regex work
    const normalizedRows: NormRow[] = allRows.map((row) => ({
        ...row,
        _std: normalizeKey(row.standard_concept),
        _concept: normalizeKey(row.concept),
        _label: normalizeKey(row.label),
        _isAbstract: toBoolean(row.is_abstract),
    } as unknown as NormRow));

    // Normalize all rule needles upfront (excludeLabel/label need normalize too)
    const normalizedFieldRules = Object.fromEntries(
        Object.entries(fieldRules).map(([field, rule]) => {
            const norm: typeof rule = {};
            if (rule.standard) norm.standard = rule.standard.map((s) => normalizeKey(s));
            if (rule.concept) norm.concept = rule.concept.map((s) => normalizeKey(s));
            if (rule.label) norm.label = rule.label.map((s) => normalizeKey(s));
            if (rule.exactStandard) norm.exactStandard = rule.exactStandard.map((s) => normalizeKey(s));
            if (rule.exactConcept) norm.exactConcept = rule.exactConcept.map((s) => normalizeKey(s));
            if (rule.exactLabel) norm.exactLabel = rule.exactLabel.map((s) => normalizeKey(s));
            if (rule.excludeConcept) norm.excludeConcept = rule.excludeConcept.map((s) => normalizeKey(s));
            if (rule.excludeLabel) norm.excludeLabel = rule.excludeLabel.map((s) => normalizeKey(s));
            return [field, norm];
        })
    ) as typeof fieldRules;

    const isTotalField = (field: string): boolean =>
        [
            "totalAssets",
            "totalLiabilities",
            "shareholdersEquity",
            "totalCurrentAssets",
            "totalCurrentLiabilities",
        ].includes(field);

    const byFieldByYear = new Map<string, Map<number, number>>();
    for (const [field, rule] of Object.entries(normalizedFieldRules)) {
        const matchedRows = normalizedRows.filter((row) => rowMatchesField(row, rule));
        const prioritizedRows = isTotalField(field)
            ? [...matchedRows].sort((a, b) => Number(toBoolean((a as AnyRecord).is_total)) - Number(toBoolean((b as AnyRecord).is_total)))
            : matchedRows;
        const valuesByYear = new Map<number, number>();

        for (const year of years) {
            if (field === "marketableSecurities" || field === "stockBasedComp") {
                let sum = 0;
                const seenConcepts = new Set<string>();
                for (const row of prioritizedRows) {
                    const conceptKey = (row as NormRow)._concept || normalizeKey(row.label);
                    if (conceptKey && seenConcepts.has(conceptKey)) continue;
                    if (conceptKey) seenConcepts.add(conceptKey);
                    sum += toNumber(rowValueForYear(row as NativeStatementRow, year));
                }
                valuesByYear.set(year, sum);
            } else {
                let picked = 0;
                let found = false;
                for (const row of prioritizedRows) {
                    const value = toNumber(rowValueForYear(row as NativeStatementRow, year));
                    if (!found || Math.abs(value) > Math.abs(picked)) {
                        picked = value;
                        found = true;
                    }
                }
                valuesByYear.set(year, found ? picked : 0);
            }
        }

        byFieldByYear.set(field, valuesByYear);
    }

    const fieldSeriesCache = new Map<string, number[]>();
    const series = (field: string): number[] => {
        const cached = fieldSeriesCache.get(field);
        if (cached) return cached;

        const map = byFieldByYear.get(field) || new Map<number, number>();
        const values = years.map((year) => toNumber(map.get(year)));
        fieldSeriesCache.set(field, values);
        return values;
    };

    const revenue = series("revenue");
    const ebitRaw = series("ebit");
    const interestExpense = series("interestExpense");
    const netIncome = series("netIncome");
    const incomeTaxExpense = series("incomeTaxExpense");
    const ebit = years.map((_, i) => {
        const raw = ebitRaw[i] || 0;
        const pretax = (netIncome[i] || 0) + (incomeTaxExpense[i] || 0);
        const interest = Math.abs(interestExpense[i] || 0);
        const derived = pretax > 0 ? pretax + interest : 0;
        if (raw !== 0) return raw;
        return derived || raw;
    });
    const depreciationBase = series("depreciation");
    const ebitda = years.map((_, i) => {
        const rev = revenue[i] || 0;
        const dep = depreciationBase[i] || 0;
        const e = ebit[i] || 0;
        if (Math.abs(e + dep) > 0) return e + dep;
        return rev > 0 ? rev * 0.18 : 0;
    });

    const currentDebt = series("currentDebt");
    const longTermDebt = series("longTermDebt");
    const totalDebt = years.map((_, i) => (currentDebt[i] || 0) + (longTermDebt[i] || 0));
    const cashSeries = series("cash");
    const cashAndMarketableCombinedSeries = series("cashAndMarketableCombined");
    const explicitMarketableSecurities = series("marketableSecurities");
    const marketableSecurities = years.map((_, i) => {
        const explicit = explicitMarketableSecurities[i] || 0;
        if (Math.abs(explicit) > 0) return explicit;
        const cashAndMarketable = cashAndMarketableCombinedSeries[i] || 0;
        const cashOnly = cashSeries[i] || 0;
        if (cashAndMarketable > 0 && cashOnly > 0 && cashAndMarketable >= cashOnly) {
            return cashAndMarketable - cashOnly;
        }
        return 0;
    });

    const accountsReceivable = series("accountsReceivable");
    const inventory = series("inventory");
    const accountsPayable = series("accountsPayable");
    const nwcChange = years.map((_, i) => {
        if (i === 0) return 0;
        const prev = (accountsReceivable[i - 1] || 0) + (inventory[i - 1] || 0) - (accountsPayable[i - 1] || 0);
        const curr = (accountsReceivable[i] || 0) + (inventory[i] || 0) - (accountsPayable[i] || 0);
        return curr - prev;
    });

    const cfo = series("cfo");
    const capex = series("capex").map((v) => Math.abs(v));
    const fcff = years.map((_, i) => (cfo[i] || 0) - Math.abs(capex[i] || 0));

    const taxRate = years.map((_, i) => {
        const ni = netIncome[i] || 0;
        const tax = incomeTaxExpense[i] || 0;
        const pretax = ni + tax;
        if (pretax > 0) {
            return Math.max(0, Math.min(0.5, tax / pretax));
        }
        return 0.21;
    });

    const sharesOutstanding =
        toPositiveNumber(nativeFinancials.shares_outstanding) ||
        toPositiveNumber(keyMetrics.shares_outstanding_diluted) ||
        toPositiveNumber(keyMetrics.shares_outstanding_basic) ||
        deriveSharesFromMarketValue(market, profile);

    const normalizedProfile = asRecord(profileRaw);
    const price = toPositiveNumber(market.current_price ?? normalizedProfile.currentPrice ?? normalizedProfile.current_price);
    const beta = toPositiveNumber(market.beta ?? normalizedProfile.beta) || 1.0;

    const totalAssetsRaw = series("totalAssets");
    const totalLiabilitiesRaw = series("totalLiabilities");
    const liabilitiesAndEquityRaw = series("liabilitiesAndEquity");
    const shareholdersEquityRaw = series("shareholdersEquity");
    const totalCurrentAssetsRaw = series("totalCurrentAssets");
    const totalCurrentLiabilitiesRaw = series("totalCurrentLiabilities");
    const otherCurrentAssets = series("otherCurrentAssets");
    const ppeNet = series("ppeNet");
    const otherAssets = series("otherAssets");
    const otherCurrentLiabilities = series("otherCurrentLiabilities");
    const otherLiabilities = series("otherLiabilities");

    // Fallback reconciliation when explicit total rows are absent or weak.
    let totalAssets = years.map((_, i) => {
        const explicit = totalAssetsRaw[i] || 0;
        if (Math.abs(explicit) > 0) return explicit;
        const implied =
            (series("cash")[i] || 0) +
            (marketableSecurities[i] || 0) +
            (accountsReceivable[i] || 0) +
            (inventory[i] || 0) +
            (otherCurrentAssets[i] || 0) +
            (ppeNet[i] || 0) +
            (otherAssets[i] || 0);
        const liabAndEq = liabilitiesAndEquityRaw[i] || 0;
        if (Math.abs(implied) <= 0 && liabAndEq > 0) return liabAndEq;
        return implied;
    });
    let totalLiabilities = years.map((_, i) => {
        const explicit = totalLiabilitiesRaw[i] || 0;
        if (Math.abs(explicit) > 0) return explicit;
        const implied =
            (accountsPayable[i] || 0) +
            (otherCurrentLiabilities[i] || 0) +
            (currentDebt[i] || 0) +
            (longTermDebt[i] || 0) +
            (otherLiabilities[i] || 0);
        return implied;
    });
    let shareholdersEquity = years.map((_, i) => {
        const explicit = shareholdersEquityRaw[i] || 0;
        if (Math.abs(explicit) > 0) return explicit;
        const residual = (totalAssets[i] || 0) - (totalLiabilities[i] || 0);
        return residual;
    });
    const totalCurrentAssets = years.map((_, i) => {
        const explicit = totalCurrentAssetsRaw[i] || 0;
        if (Math.abs(explicit) > 0) return explicit;
        return (
            (cashSeries[i] || 0) +
            (marketableSecurities[i] || 0) +
            (accountsReceivable[i] || 0) +
            (inventory[i] || 0) +
            (otherCurrentAssets[i] || 0)
        );
    });
    const totalCurrentLiabilities = years.map((_, i) => {
        const explicit = totalCurrentLiabilitiesRaw[i] || 0;
        if (Math.abs(explicit) > 0) return explicit;
        return (accountsPayable[i] || 0) + (otherCurrentLiabilities[i] || 0) + (currentDebt[i] || 0);
    });

    // Enforce accounting identity by year to avoid UI balance-check drift from partial concept coverage.
    totalAssets = totalAssets.map((assets, i) => {
        const liabEqTotal = liabilitiesAndEquityRaw[i] || 0;
        if (assets === 0 && liabEqTotal > 0) return liabEqTotal;
        return assets;
    });
    totalLiabilities = totalLiabilities.map((liabilities, i) => {
        const liabEqTotal = liabilitiesAndEquityRaw[i] || 0;
        const equity = shareholdersEquity[i] || 0;
        if (liabilities === 0 && liabEqTotal > 0 && Math.abs(equity) > 0) {
            return liabEqTotal - equity;
        }
        return liabilities;
    });
    shareholdersEquity = shareholdersEquity.map((equity, i) => {
        const assets = totalAssets[i] || 0;
        const liabilities = totalLiabilities[i] || 0;
        const liabEqTotal = liabilitiesAndEquityRaw[i] || 0;
        if (equity === 0 && liabEqTotal > 0 && Math.abs(liabilities) > 0) {
            return liabEqTotal - liabilities;
        }
        const diff = assets - (liabilities + equity);
        if (Math.abs(diff) > 0.1) {
            return assets - liabilities;
        }
        return equity;
    });

    if (years.length === 0) {
        const revenueFallback = toNumber(keyMetrics.revenue);
        const netIncomeFallback = toNumber(keyMetrics.net_income);
        const operatingIncomeFallback = toNumber(keyMetrics.operating_income);
        const operatingCffFallback = toNumber(keyMetrics.operating_cash_flow);
        const capexFallback = Math.abs(toNumber(keyMetrics.capital_expenditures));
        const totalAssetsFallback = toNumber(keyMetrics.total_assets);
        const totalLiabilitiesFallback = toNumber(keyMetrics.total_liabilities);
        const equityFallback = toNumber(keyMetrics.stockholders_equity);
        return {
            symbol: String(nativeFinancials.ticker || profile.ticker || "").toUpperCase(),
            years: usableYears,
            revenue: [revenueFallback],
            costOfRevenue: [0],
            grossProfit: [0],
            ebitda: [operatingIncomeFallback],
            ebit: [operatingIncomeFallback],
            interestExpense: [0],
            incomeTaxExpense: [0],
            netIncome: [netIncomeFallback],
            depreciation: [0],
            capex: [capexFallback],
            nwcChange: [0],
            taxRate: [0.21],
            accountsReceivable: [0],
            inventory: [0],
            accountsPayable: [0],
            cash: [0],
            totalCurrentAssets: [0],
            otherCurrentAssets: [0],
            totalAssets: [totalAssetsFallback],
            totalDebt: [0],
            currentDebt: [0],
            longTermDebt: [0],
            shareholdersEquity: [equityFallback],
            ppeNet: [0],
            otherAssets: [0],
            otherLiabilities: [0],
            totalLiabilities: [totalLiabilitiesFallback],
            totalCurrentLiabilities: [0],
            otherCurrentLiabilities: [0],
            deferredRevenue: [0],
            retainedEarnings: [0],
            researchAndDevelopment: [0],
            generalAndAdministrative: [0],
            stockBasedComp: [0],
            dividendsPaid: [0],
            marketableSecurities: [0],
            cfo: [operatingCffFallback],
            fcff: [operatingCffFallback - capexFallback],
            sharesOutstanding,
            price,
            beta,
            currency: String(market.currency || profile.currency || "USD"),
            lastUpdated: Date.now(),
        };
    }

    return {
        symbol: String(nativeFinancials.ticker || profile.ticker || "").toUpperCase(),
        years: usableYears,
        revenue,
        costOfRevenue: series("costOfRevenue"),
        grossProfit: series("grossProfit"),
        ebitda,
        ebit,
        interestExpense,
        incomeTaxExpense,
        netIncome,
        depreciation: depreciationBase,
        capex,
        nwcChange,
        taxRate,
        accountsReceivable,
        inventory,
        accountsPayable,
        cash: series("cash"),
        totalCurrentAssets,
        otherCurrentAssets: series("otherCurrentAssets"),
        totalAssets,
        totalDebt,
        currentDebt,
        longTermDebt,
        shareholdersEquity,
        ppeNet: series("ppeNet"),
        otherAssets: series("otherAssets"),
        otherLiabilities: series("otherLiabilities"),
        totalLiabilities,
        totalCurrentLiabilities,
        otherCurrentLiabilities: series("otherCurrentLiabilities"),
        deferredRevenue: series("deferredRevenue"),
        retainedEarnings: series("retainedEarnings"),
        researchAndDevelopment: series("researchAndDevelopment"),
        generalAndAdministrative: series("generalAndAdministrative"),
        stockBasedComp: series("stockBasedComp"),
        dividendsPaid: series("dividendsPaid"),
        marketableSecurities,
        cfo,
        fcff,
        sharesOutstanding,
        price,
        beta,
        currency: String(market.currency || profile.currency || "USD"),
        lastUpdated: Date.now(),
    };
}

export function hasUsableNativeFinancials(payloadRaw: unknown, minYears = 1): boolean {
    const payloadRecord = asRecord(payloadRaw);
    if (!payloadRecord.financials_native) return false;
    const payload = payloadRecord as unknown as NativeUnifiedPayload;
    const nativeFinancials = asRecord(payload.financials_native);
    const statements = nativeFinancials.statements;
    const incomeRows = getStatementRows(statements, "income");
    const balanceRows = getStatementRows(statements, "balance");
    const cashRows = getStatementRows(statements, "cashflow");
    const allRows = [...incomeRows, ...balanceRows, ...cashRows];
    const yearCoverage = findYearCoverage(allRows);
    if (yearCoverage.size >= Math.max(1, minYears)) return true;

    const keyMetrics = asRecord(nativeFinancials.key_metrics);
    const hasFallbackMetrics =
        toNumber(keyMetrics.revenue) !== 0 ||
        toNumber(keyMetrics.net_income) !== 0 ||
        toNumber(keyMetrics.operating_cash_flow) !== 0;
    return allRows.length > 0 || hasFallbackMetrics;
}
