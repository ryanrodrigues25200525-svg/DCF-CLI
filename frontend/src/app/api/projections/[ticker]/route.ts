import { NextRequest, NextResponse } from "next/server";

import { NativeFinancialsPayload, NativeUnifiedPayload } from "@/core/types";
import { mapNativeFinancialsToHistoricals, mapNativeProfile } from "@/services/integration/sec/native-normalizer";

const BACKEND_BASE_URL =
    process.env.SEC_SERVICE_URL ||
    process.env.NEXT_PUBLIC_SEC_SERVICE_URL ||
    "http://localhost:8000";

const toPercent = (value: unknown, fallback: number): number => {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return parsed / 100;
};

export async function POST(
    request: NextRequest,
    { params }: { params: Promise<{ ticker: string }> }
) {
    const { ticker } = await params;
    let inputs: Record<string, unknown>;
    try {
        inputs = await request.json();
    } catch {
        return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
    }

    const normalizedTicker = ticker.trim().toUpperCase();
    if (!normalizedTicker) {
        return NextResponse.json({ error: "Ticker required" }, { status: 400 });
    }

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15_000);
        let unifiedRes: Response;
        try {
            unifiedRes = await fetch(
                `${BACKEND_BASE_URL}/api/company/${normalizedTicker}/unified/native?years=5`,
                { cache: "no-store", signal: controller.signal }
            );
        } finally {
            clearTimeout(timeoutId);
        }
        if (!unifiedRes.ok) {
            return NextResponse.json(
                { error: `Failed to fetch upstream native data (${unifiedRes.status})` },
                { status: 502 }
            );
        }

        const payload = (await unifiedRes.json()) as NativeUnifiedPayload;
        const nativeFinancials = (payload.financials_native || {}) as NativeFinancialsPayload;
        const market = (payload.market || {}) as Record<string, unknown>;
        const profile = mapNativeProfile(payload.profile || {}, nativeFinancials, market);
        const historicals = mapNativeFinancialsToHistoricals(nativeFinancials, market, profile);

        const lastIdx = historicals.revenue.length - 1;
        if (lastIdx < 0) {
            return NextResponse.json({ error: "No base financial history found" }, { status: 404 });
        }

        const lastRevenue = Number(historicals.revenue[lastIdx] || 0);
        const lastGrossProfit = Number(historicals.grossProfit[lastIdx] || 0);
        if (!(lastRevenue > 0)) {
            return NextResponse.json({ error: "Insufficient baseline revenue data" }, { status: 404 });
        }

        const revenueCagr = toPercent(inputs.revenueCAGR, 0.08);
        const ebitdaMargin = toPercent(inputs.ebitdaMargin, 0.25);
        const taxRate = toPercent(inputs.taxRate, 0.21);
        const grossMargin = Math.max(0, Math.min(1, lastGrossProfit / lastRevenue));

        const projections = {
            revenue: [] as number[],
            costOfRevenue: [] as number[],
            grossProfit: [] as number[],
            ebitda: [] as number[],
            operatingIncome: [] as number[],
            netIncome: [] as number[],
        };

        let currentRevenue = lastRevenue;
        for (let i = 0; i < 5; i++) {
            currentRevenue *= 1 + revenueCagr;
            projections.revenue.push(currentRevenue);

            const grossProfit = currentRevenue * grossMargin;
            projections.grossProfit.push(grossProfit);
            projections.costOfRevenue.push(currentRevenue - grossProfit);

            const ebitda = currentRevenue * ebitdaMargin;
            projections.ebitda.push(ebitda);

            const operatingIncome = ebitda * 0.85;
            projections.operatingIncome.push(operatingIncome);

            const netIncome = operatingIncome * (1 - taxRate);
            projections.netIncome.push(netIncome);
        }

        return NextResponse.json(projections);
    } catch (error) {
        console.error("[API /projections] Projection failed:", error);
        return NextResponse.json({ error: "Projection failed" }, { status: 500 });
    }
}
